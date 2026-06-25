export function buildMonitorToolCall(sessionId: string): string {
  const filePath = `$HOME/.claude/sessions/${sessionId}-inbox.jsonl`;
  const readyPath = `$HOME/.claude/sessions/${sessionId}-monitor.ready`;
  const command = [
    `FILE="${filePath}"`,
    `READY="${readyPath}"`,
    `touch "$FILE" "$READY"`,
    `trap "rm -f \\"$READY\\"" EXIT`,
    `PARENT=$$`,
    `(while [ -f "$READY" ] && kill -0 $PARENT 2>/dev/null; do touch "$READY"; sleep 20; done) &`,
    `HB=$!`,
    `tail -f -n 0 "$FILE" | while IFS= read -r line; do`,
    `  [ -f "$READY" ] || break`,
    `  python3 -c "`,
    `import sys, json`,
    `try:`,
    `    d = json.loads(sys.argv[1])`,
    `    msg = d.get('message', '')`,
    `    if msg:`,
    `        print('MSG: ' + msg)`,
    `    else:`,
    `        print('RAW: ' + sys.argv[1])`,
    `except Exception as e:`,
    `    print('ERR: ' + str(e) + ' | ' + sys.argv[1])`,
    `" "$line"`,
    `done`,
    `kill $HB 2>/dev/null`,
  ].join("\n");

  return JSON.stringify(
    {
      description: `Inbox messages from Claude Code Dashboard for session ${sessionId.slice(0, 8)}`,
      persistent: true,
      command,
    },
    null,
    2
  );
}
