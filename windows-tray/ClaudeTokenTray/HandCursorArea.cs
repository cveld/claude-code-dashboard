using Microsoft.UI.Input;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace ClaudeTokenTray;

// A plain invisible container that shows a hand cursor over whatever area it covers - either
// wrapped around real content (the counter chips) or used bare at a fixed size as an enlarged,
// invisible hit/cursor area around a small visual marker (the chart's prediction dots). `Cursor`
// isn't a public property on UIElement in this WinUI version - `ProtectedCursor` only exists for
// a class to set on itself, and Ellipse/StackPanel are sealed, so this Grid subclass exists
// purely to have somewhere to set it. Background must be a real brush (even Transparent), not
// null, or the area isn't hit-testable at all - same rule as the chart canvases (see
// docs/windows-tray.md's Canvas hit-testing gotcha).
public sealed class HandCursorArea : Grid
{
    public HandCursorArea()
    {
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        ProtectedCursor = InputSystemCursor.Create(InputSystemCursorShape.Hand);
    }
}
