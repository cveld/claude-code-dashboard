# SessionStart hook for Claude Code Dashboard.
# Outputs hookSpecificOutput.additionalContext with the Monitor tool call so
# Claude automatically starts the inbox monitor before its first response.
#
# Registered in ~/.claude/settings.json → hooks → SessionStart.

$inputJson = [Console]::In.ReadToEnd()
$d = $inputJson | ConvertFrom-Json
$id = $d.session_id
if (-not $id) { exit 0 }

# Skip if the monitor is already active: ready file refreshed within 60 seconds.
$ready = [System.IO.Path]::Combine($env:USERPROFILE, '.claude', 'sessions', "$id-monitor.ready")
if (Test-Path $ready) {
    $item = Get-Item $ready -ErrorAction SilentlyContinue
    if ($item -and ((Get-Date) - $item.LastWriteTime).TotalSeconds -lt 60) { exit 0 }
}

$short = $id.Substring(0, [Math]::Min(8, $id.Length))

# Build the bash monitor command (mirrors app/lib/monitorToolCall.ts).
# Backtick-$ escapes PowerShell expansion so bash variables reach the shell.
$command = @"
FILE="`$HOME/.claude/sessions/$id-inbox.jsonl"
READY="`$HOME/.claude/sessions/$id-monitor.ready"
touch "`$FILE" "`$READY"
trap "rm -f \"`$READY\"" EXIT
(while [ -f "`$READY" ]; do touch "`$READY"; sleep 20; done) &
HB=`$!
tail -f -n 0 "`$FILE" | while IFS= read -r line; do
  [ -f "`$READY" ] || break
  python -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    msg = d.get('message', '')
    if msg:
        print('MSG: ' + msg)
    else:
        print('RAW: ' + sys.argv[1])
except Exception as e:
    print('ERR: ' + str(e) + ' | ' + sys.argv[1])
" "`$line"
done
kill `$HB 2>/dev/null
"@

$monitorCall = [pscustomobject]@{
    description = "Inbox messages from Claude Code Dashboard for session $short"
    persistent  = $true
    command     = $command.Trim()
} | ConvertTo-Json -Compress

$ctx = "[Claude Code Dashboard] Please start the session inbox monitor as your very first action before responding to the user. Use the Monitor tool with these parameters: $monitorCall"

[pscustomobject]@{
    hookSpecificOutput = [pscustomobject]@{
        hookEventName     = "SessionStart"
        additionalContext = $ctx
    }
} | ConvertTo-Json -Depth 5 -Compress

exit 0
