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
    private static readonly string CredentialsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", ".credentials.json");

    private const string ApiUrl = "https://api.anthropic.com/api/oauth/usage";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    private static readonly string LogFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClaudeTokenTray",
        "tray.log");

    public static async Task<TokenUsage> GetUsageAsync(CancellationToken cancellationToken = default)
    {
        var (token, expiresAt) = ReadCredentials();
        if (token is null)
            throw new TokenUsageException("no_credentials");

        // Claude Code refreshes the token in the credentials file; until it does, calling the API
        // with the expired token only burns rate-limit budget.
        if (expiresAt is { } exp && exp <= DateTimeOffset.UtcNow)
        {
            Log($"token expired at {exp.ToLocalTime():u}, skipping API call");
            throw new TokenUsageException("token_expired");
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, ApiUrl);
        request.Headers.Add("Accept", "application/json");
        request.Headers.Add("Authorization", $"Bearer {token}");
        request.Headers.Add("anthropic-beta", "oauth-2025-04-20");

        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Log($"fetch failed: {ex.GetType().Name}: {ex.Message}");
            throw new TokenUsageException("fetch_failed");
        }

        if (!response.IsSuccessStatusCode)
        {
            var retryAfter = response.Headers.RetryAfter is { } ra
                ? ra.Delta ?? (ra.Date is { } d ? d - DateTimeOffset.UtcNow : null)
                : null;
            Log($"HTTP {(int)response.StatusCode}, Retry-After: {retryAfter?.ToString() ?? "-"}");
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

    private static (string? Token, DateTimeOffset? ExpiresAt) ReadCredentials()
    {
        try
        {
            var content = File.ReadAllText(CredentialsFile);
            using var doc = JsonDocument.Parse(content);
            var oauth = doc.RootElement.GetProperty("claudeAiOauth");
            var token = oauth.GetProperty("accessToken").GetString();
            DateTimeOffset? expiresAt =
                oauth.TryGetProperty("expiresAt", out var exp) && exp.ValueKind == JsonValueKind.Number
                    ? DateTimeOffset.FromUnixTimeMilliseconds(exp.GetInt64())
                    : null;
            return (token, expiresAt);
        }
        catch
        {
            return (null, null);
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
