using System.Security.Cryptography;
using System.Text.Json;

namespace ClaudeTokenTray;

public sealed record TokenCandidate(string Source, string Token, DateTimeOffset? ExpiresAt);

// Everything the tray found: tokens it may try, and how many it skipped because they expired.
public sealed record TokenSourceResult(IReadOnlyList<TokenCandidate> Usable, int Expired);

// Collects OAuth access tokens from both places Claude keeps them, so the tray works for users of
// the CLI, of the desktop app, or both:
//   cli     ~/.claude/.credentials.json (written by the `claude` CLI)
//   desktop %APPDATA%\Claude\config.json -> oauth:tokenCacheV2 / oauth:tokenCache (Electron
//           safeStorage: AES-256-GCM, key in "Local State" wrapped with DPAPI for the current user)
// Tokens are only read, never refreshed: refresh tokens rotate, so using one here would sign the
// owning app out.
public static class TokenSources
{
    // Treat a token as expired slightly early so a request never races the expiry.
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromMinutes(1);

    private static readonly string UserProfile =
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    private static readonly string CredentialsFile = Path.Combine(UserProfile, ".claude", ".credentials.json");

    // Built from the profile instead of SpecialFolder.ApplicationData: this app runs with package
    // identity, and AppData paths can be redirected into the package's private store.
    private static readonly string DesktopDir = Path.Combine(UserProfile, "AppData", "Roaming", "Claude");

    // Scope the usage endpoint requires.
    private const string ProfileScope = "user:profile";

    public static TokenSourceResult Load()
    {
        var usable = new List<TokenCandidate>();
        var expired = 0;

        foreach (var candidate in ReadCli().Concat(ReadDesktop()))
        {
            if (candidate.ExpiresAt is { } exp && exp <= DateTimeOffset.UtcNow + ExpirySkew)
                expired++;
            else
                usable.Add(candidate);
        }

        // CLI first (the explicit login for that tool), then the desktop app. Within a source the
        // longest-lived token wins. A 401/403 makes the caller fall through to the next one.
        var ordered = usable
            .OrderBy(c => c.Source == "cli" ? 0 : 1)
            .ThenByDescending(c => c.ExpiresAt ?? DateTimeOffset.MaxValue)
            .ToList();

        return new TokenSourceResult(ordered, expired);
    }

    private static IEnumerable<TokenCandidate> ReadCli()
    {
        try
        {
            using var doc = JsonDocument.Parse(ReadShared(CredentialsFile));
            var oauth = doc.RootElement.GetProperty("claudeAiOauth");
            var token = oauth.GetProperty("accessToken").GetString();
            if (string.IsNullOrEmpty(token))
                return [];

            return [new TokenCandidate("cli", token, ReadExpiry(oauth))];
        }
        catch
        {
            return [];
        }
    }

    private static IEnumerable<TokenCandidate> ReadDesktop()
    {
        var candidates = new List<TokenCandidate>();
        try
        {
            var key = ReadDesktopKey();
            if (key is null)
                return candidates;

            using var config = JsonDocument.Parse(ReadShared(Path.Combine(DesktopDir, "config.json")));
            foreach (var cacheName in new[] { "oauth:tokenCacheV2", "oauth:tokenCache" })
            {
                if (!config.RootElement.TryGetProperty(cacheName, out var cacheProp) ||
                    cacheProp.ValueKind != JsonValueKind.String)
                    continue;

                var plain = Decrypt(key, cacheProp.GetString()!);
                if (plain is null)
                    continue;

                using var cache = JsonDocument.Parse(plain);
                foreach (var entry in cache.RootElement.EnumerateObject())
                {
                    // The key ends in the granted scopes; only tokens that can read usage are useful.
                    if (!entry.Name.Contains(ProfileScope, StringComparison.Ordinal) ||
                        entry.Value.ValueKind != JsonValueKind.Object ||
                        !entry.Value.TryGetProperty("token", out var tokenProp) ||
                        tokenProp.GetString() is not { Length: > 0 } token)
                        continue;

                    candidates.Add(new TokenCandidate("desktop", token, ReadExpiry(entry.Value)));
                }
            }
        }
        catch
        {
            // desktop app missing, locked, or in a format we don't understand: not a failure
        }

        return candidates;
    }

    // "Local State" holds os_crypt.encrypted_key = base64("DPAPI" + DPAPI blob), the key for v10/v11
    // values. Chromium's app-bound encryption (v20 values, key in the separate
    // os_crypt.app_bound_encrypted_key field, "APPB" prefix) can only be unwrapped by the app
    // itself; we neither read that field nor decrypt v20 values.
    private static byte[]? ReadDesktopKey()
    {
        using var state = JsonDocument.Parse(ReadShared(Path.Combine(DesktopDir, "Local State")));
        var encoded = state.RootElement.GetProperty("os_crypt").GetProperty("encrypted_key").GetString();
        if (string.IsNullOrEmpty(encoded))
            return null;

        var blob = Convert.FromBase64String(encoded);
        if (blob.Length <= 5 || !blob.AsSpan(0, 5).SequenceEqual("DPAPI"u8))
            return null;

        return ProtectedData.Unprotect(blob[5..], null, DataProtectionScope.CurrentUser);
    }

    // safeStorage value: base64("v10" + 12-byte nonce + ciphertext + 16-byte GCM tag).
    private static string? Decrypt(byte[] key, string base64)
    {
        var raw = Convert.FromBase64String(base64);
        if (raw.Length < 3 + 12 + 16 || !(raw.AsSpan(0, 3).SequenceEqual("v10"u8) || raw.AsSpan(0, 3).SequenceEqual("v11"u8)))
            return null;

        var nonce = raw.AsSpan(3, 12);
        var tag = raw.AsSpan(raw.Length - 16, 16);
        var cipher = raw.AsSpan(15, raw.Length - 15 - 16);
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return System.Text.Encoding.UTF8.GetString(plain);
    }

    private static DateTimeOffset? ReadExpiry(JsonElement element) =>
        element.TryGetProperty("expiresAt", out var exp) && exp.ValueKind == JsonValueKind.Number
            ? DateTimeOffset.FromUnixTimeMilliseconds(exp.GetInt64())
            : null;

    // The owning apps keep these files open, so don't ask for exclusive access.
    private static string ReadShared(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
