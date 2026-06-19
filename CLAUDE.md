@AGENTS.md
@docs/architecture.md
@docs/gotchas.md

# Workspace Dashboard App

Next.js 16 + React 19 + Tailwind 4 web app om Claude Code sessies te browsen vanuit `~/.claude/`.

## Dev

```
npm run dev   # http://localhost:3000
```

## Wat dit is

- Leest `.claude/projects/<slug>/*.jsonl` voor sessie-transcripten
- Leest `.claude/sessions/*.json` voor actieve sessies
- Slaat read-state op in `.claude/dashboard-read.json`
- Dark theme (zinc-900/950), geen auth, lokaal only

## Slug-formaat

Claude encodeert paden als slug: `:` → `-`, path-separators → `-`.  
`c:\work\git\foo` → `c--work-git-foo`  
Decodering is best-effort (koppeltekens in mapnamen zijn niet te onderscheiden van separators).

