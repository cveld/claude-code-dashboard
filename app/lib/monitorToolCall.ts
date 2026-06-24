export function buildMonitorToolCall(sessionId: string): string {
  const filePath = `$HOME/.claude/sessions/${sessionId}-inbox.jsonl`;
  const readyPath = `$HOME/.claude/sessions/${sessionId}-monitor.ready`;
  const command = [
    `FILE="${filePath}"`,
    `READY="${readyPath}"`,
    `touch "$FILE"`,
    `touch "$READY"`,
    `trap "rm -f \\"$READY\\"" EXIT`,
    `tail -f -n 0 "$FILE" | while IFS= read -r line; do`,
    `  python -c "`,
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
