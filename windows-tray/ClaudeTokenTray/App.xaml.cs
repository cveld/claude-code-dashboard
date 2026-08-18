using H.NotifyIcon;
using Microsoft.UI.Xaml;

namespace ClaudeTokenTray;

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// This app has no main window: it launches straight to the tray icon.
/// </summary>
public partial class App : Application
{
    private TrayIconService? _trayIconService;
    private HistoryWindow? _historyWindow;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var trayIcon = (TaskbarIcon)Resources["TrayIcon"];
        _trayIconService = new TrayIconService(trayIcon, ShowHistoryWindow);
    }

    // Left-clicking the tray icon (or "Show history..." in its menu) opens this. Built once and
    // kept for the app's lifetime: its title-bar close button hides it rather than destroying
    // it (see HistoryWindow's AppWindow.Closing handler), so there's never a second one to build.
    private void ShowHistoryWindow()
    {
        _historyWindow ??= new HistoryWindow();
        _historyWindow.ShowAndActivate();
    }
}
