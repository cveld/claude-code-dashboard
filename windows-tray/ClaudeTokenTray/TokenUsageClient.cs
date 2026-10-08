using System.Text.Json;

namespace ClaudeTokenTray;

public sealed class TokenUsageException : Exception
{
    public TokenUsageException(string message, TimeSpan? retryAfter = null) : base(message)
    {
        RetryAfter = retryAfter;
    }

    // Server-provided backoff hint (Retry-After header on 429), if any.
    public TimeSpan? RetryAfter { get; }
}

public static class TokenUsageClient
{
    private const string ApiUrl = "https://api.anthropic.com/api/oauth/usage";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    private static readonly string LogFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClaudeTokenTray",
        "tray.log");

    private static string? _lastSource;

    public static async Task<TokenUsage> GetUsageAsync(CancellationToken cancellationToken = default)
    {
        var sources = TokenSources.Load();
        if (sources.Usable.Count == 0)
        {
            if (sources.Expired == 0)
                throw new TokenUsageException("no_credentials");

            // The owning app (CLI or desktop) refreshes its token on its own schedule; until it
            // does, calling the API with an expired token only burns rate-limit budget.
            Log($"{sources.Expired} token(s) found, all expired, skipping API call");
            throw new TokenUsageException("token_expired");
        }

        // Try each usable token in preference order; only an auth rejection moves on to the next.
        TokenUsageException? authError = null;
        foreach (var candidate in sources.Usable)
        {
            try
            {
                var usage = await FetchAsync(candidate, cancellationToken).ConfigureAwait(false);
                if (_lastSource != candidate.Source)
                {
                    Log($"using {candidate.Source} token");
                    _lastSource = candidate.Source;
                }

                return usage;
            }
            catch (TokenUsageException ex) when (ex.Message is "api_error_401" or "api_error_403")
            {
                authError = ex;
            }
        }

        throw authError!;
    }

    private static async Task<TokenUsage> FetchAsync(TokenCandidate candidate, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ApiUrl);
        request.Headers.Add("Accept", "application/json");
        request.Headers.Add("Authorization", $"Bearer {candidate.Token}");
        request.Headers.Add("anthropic-beta", "oauth-2025-04-20");

        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Log($"fetch failed ({candidate.Source}): {ex.GetType().Name}: {ex.Message}");
            throw new TokenUsageException("fetch_failed");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var retryAfter = response.Headers.RetryAfter is { } ra
                    ? ra.Delta ?? (ra.Date is { } d ? d - DateTimeOffset.UtcNow : null)
                    : null;
                Log($"HTTP {(int)response.StatusCode} ({candidate.Source}), Retry-After: {retryAfter?.ToString() ?? "-"}");
                throw new TokenUsageException($"api_error_{(int)response.StatusCode}", retryAfter);
            }

            using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            var root = await JsonSerializer.DeserializeAsync<JsonElement>(stream, cancellationToken: cancellationToken)
                .ConfigureAwait(false);

            return new TokenUsage(
                ParseWindow(root, "five_hour"),
                ParseWindow(root, "seven_day"),
                ParseWindow(root, "seven_day_sonnet"));
        }
    }

    // Small append-only diagnostic log so a failing poll leaves a trace of the real HTTP status.
    private static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 256 * 1024)
                File.Delete(LogFile);
            File.AppendAllText(LogFile, $"{DateTimeOffset.Now:u} {message}{Environment.NewLine}");
        }
        catch
        {
            // logging must never break polling
        }
    }

    private static UsageLimitWindow? ParseWindow(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var window) || window.ValueKind != JsonValueKind.Object)
            return null;

        if (!window.TryGetProperty("utilization", out var utilization) ||
            utilization.ValueKind is not (JsonValueKind.Number))
            return null;

        DateTimeOffset? resetsAt = window.TryGetProperty("resets_at", out var resetsAtProp) &&
            resetsAtProp.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(resetsAtProp.GetString(), out var parsed)
            ? parsed
            : null;

        return new UsageLimitWindow(utilization.GetDouble(), resetsAt);
    }
}
