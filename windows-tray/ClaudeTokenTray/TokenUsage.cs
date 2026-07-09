namespace ClaudeTokenTray;

public sealed record UsageLimitWindow(double Utilization, DateTimeOffset? ResetsAt);

public sealed record TokenUsage(
    UsageLimitWindow? FiveHour,
    UsageLimitWindow? SevenDay,
    UsageLimitWindow? SevenDaySonnet);
