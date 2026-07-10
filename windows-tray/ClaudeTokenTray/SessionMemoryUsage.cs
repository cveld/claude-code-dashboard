namespace ClaudeTokenTray;

public sealed record SessionMemoryInfo(int Pid, string Cwd, long MemoryBytes, long PagedMemoryBytes);

public sealed record SessionMemoryUsage(
    int SessionCount,
    long TotalMemoryBytes,
    long TotalPagedMemoryBytes,
    IReadOnlyList<SessionMemoryInfo> Sessions);
