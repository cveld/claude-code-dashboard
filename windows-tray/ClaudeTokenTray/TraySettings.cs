using Microsoft.Win32;

namespace ClaudeTokenTray;

// Small per-user settings bag under HKCU. Registry rather than a file so the settings survive
// the app being started from a different working directory (e.g. the "Start with Windows" entry).
internal static class TraySettings
{
    private const string KeyPath = @"Software\ClaudeTokenTray";

    public static string? Read(string name)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: false);
            return key?.GetValue(name) as string;
        }
        catch
        {
            return null;
        }
    }

    public static void Write(string name, string value)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(KeyPath);
            key.SetValue(name, value);
        }
        catch
        {
            // a setting that can't be persisted still applies for this session
        }
    }
}
