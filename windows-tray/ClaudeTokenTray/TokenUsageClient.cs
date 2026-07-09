using System.Text.Json;

namespace ClaudeTokenTray;

public sealed class TokenUsageException : Exception
{
    public TokenUsageException(string message) : base(message) { }
}

public static class TokenUsageClient
{
    private static readonly string CredentialsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", ".credentials.json");

    private const string ApiUrl = "https://api.anthropic.com/api/oauth/usage";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(5) };

    public static async Task<TokenUsage> GetUsageAsync(CancellationToken cancellationToken = default)
    {
        var token = ReadAccessToken();
        if (token is null)
            throw new TokenUsageException("no_credentials");

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
            throw new TokenUsageException("fetch_failed");
        }

        if (!response.IsSuccessStatusCode)
            throw new TokenUsageException($"api_error_{(int)response.StatusCode}");

        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var root = await JsonSerializer.DeserializeAsync<JsonElement>(stream, cancellationToken: cancellationToken)
            .ConfigureAwait(false);

        return new TokenUsage(
            ParseWindow(root, "five_hour"),
            ParseWindow(root, "seven_day"),
            ParseWindow(root, "seven_day_sonnet"));
    }

    private static string? ReadAccessToken()
    {
        try
        {
            var content = File.ReadAllText(CredentialsFile);
            using var doc = JsonDocument.Parse(content);
            return doc.RootElement
                .GetProperty("claudeAiOauth")
                .GetProperty("accessToken")
                .GetString();
        }
        catch
        {
            return null;
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
