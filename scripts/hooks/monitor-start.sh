#!/usr/bin/env bash
# Session inbox monitor for Claude Code Dashboard.
# Started automatically by the SessionStart hook in ~/.claude/settings.json.
# Writes its PID to the .ready file so the dashboard can verify the monitor
# is actually alive (not a stale file from a previous session or reboot).
#
# Usage: monitor-start.sh <session-id>
SESSION_ID="$1"
if [ -z "$SESSION_ID" ]; then
  echo "Usage: monitor-start.sh <session-id>" >&2
  exit 1
fi

# Determine the sessions directory for the current environment.
# In WSL the Windows .claude dir is under /mnt/c/Users/<user>/.claude/
# USERPROFILE is not passed from PowerShell to WSL, so we ask cmd.exe.
if grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
  WIN_PROFILE=$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r\n')
  if [ -n "$WIN_PROFILE" ]; then
    UNIX_HOME=$(echo "$WIN_PROFILE" | sed 's/\\/\//g; s/^\([A-Za-z]\):/\/mnt\/\l\1/')
    SESSIONS_DIR="$UNIX_HOME/.claude/sessions"
  else
    # Fallback: derive from PATH which contains /mnt/c/Users/<user>/
    WIN_USER=$(echo "$PATH" | grep -o '/mnt/c/Users/[^/:]*' | head -1 | sed 's|/mnt/c/Users/||')
    SESSIONS_DIR="/mnt/c/Users/$WIN_USER/.claude/sessions"
  fi
else
  SESSIONS_DIR="$HOME/.claude/sessions"
fi

FILE="$SESSIONS_DIR/${SESSION_ID}-inbox.jsonl"
READY="$SESSIONS_DIR/${SESSION_ID}-monitor.ready"

# If a ready file exists and was refreshed within 60s, the monitor is already running.
if [ -f "$READY" ]; then
  age=$(( $(date +%s) - $(date -r "$READY" +%s 2>/dev/null || echo 0) ))
  if [ "$age" -lt 60 ]; then exit 0; fi
  rm -f "$READY"
fi

mkdir -p "$SESSIONS_DIR"
touch "$FILE" "$READY"
# Heartbeat: touch the ready file every 20s so the dashboard can check liveness
# by mtime (< 60s old = alive) without needing to resolve cross-platform PIDs.
(while [ -f "$READY" ]; do touch "$READY"; sleep 20; done) &
HB_PID=$!
trap "rm -f \"$READY\"; kill $HB_PID 2>/dev/null" EXIT

PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null)
if [ -z "$PYTHON" ]; then
  echo "monitor-start.sh: python/python3 not found" >&2
  exit 1
fi

tail -f -n 0 "$FILE" | while IFS= read -r line; do
  [ -f "$READY" ] || break
  "$PYTHON" -c "
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
" "$line"
done
