using System.Diagnostics;
using System.Text.Json;

namespace ClaudeTokenTray;

// Mirrors app/api/active-sessions/route.ts's memory lookup, but queries
// Process.GetProcessById directly instead of shelling out to PowerShell -
// this runs in-process, so it's cheap enough to call on every poll tick.
public static class SessionMemoryClient
{
    private static readonly string SessionsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "sessions");

    public static SessionMemoryUsage? GetUsage()
    {
        if (!Directory.Exists(SessionsDir))
            return null;

        var sessions = new List<SessionMemoryInfo>();

        foreach (var file in Directory.EnumerateFiles(SessionsDir, "*.json"))
        {
            if (!TryReadPidAndCwd(file, out var pid, out var cwd))
                continue;

            try
            {
                using var process = Process.GetProcessById(pid);
                sessions.Add(new SessionMemoryInfo(pid, cwd, process.WorkingSet64, process.PagedMemorySize64));
            }
            catch (ArgumentException)
            {
                // process no longer running - skip
            }
        }

        if (sessions.Count == 0)
            return null;

        long totalMemory = 0;
        long totalPaged = 0;
        foreach (var s in sessions)
        {
            totalMemory += s.MemoryBytes;
            totalPaged += s.PagedMemoryBytes;
        }

        return new SessionMemoryUsage(sessions.Count, totalMemory, totalPaged, sessions);
    }

    private static bool TryReadPidAndCwd(string file, out int pid, out string cwd)
    {
        pid = 0;
        cwd = "?";
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var root = doc.RootElement;
            if (!root.TryGetProperty("pid", out var pidProp) || pidProp.ValueKind != JsonValueKind.Number)
                return false;

            pid = pidProp.GetInt32();
            if (root.TryGetProperty("cwd", out var cwdProp) && cwdProp.ValueKind == JsonValueKind.String)
                cwd = cwdProp.GetString() ?? "?";
            return true;
        }
        catch
        {
            return false;
        }
    }
}
