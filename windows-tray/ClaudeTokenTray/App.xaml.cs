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

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var trayIcon = (TaskbarIcon)Resources["TrayIcon"];
        _trayIconService = new TrayIconService(trayIcon);
    }
}
