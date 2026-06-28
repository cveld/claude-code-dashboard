@AGENTS.md

## Docs (lazy — read on demand)

| File | Contents |
|---|---|
| `docs/architecture.md` | Routes, API routes, data types, SSE, hook-events, IDE-windows |
| `docs/screens.md` | Per-screen overview of elements and behavior |
| `docs/gotchas.md` | Known pitfalls (Tailwind 4, flex layout, mobile scroll/sticky, overflow-x: clip) |
| `docs/testing.md` | Playwright e2e, screenshot script, test-results folder |
| `docs/gallery.md` | Dev-only gallery & ResponsiveViewer: DEVICE_PRESETS, CLIP_PRESETS, ChromeBar scroll-away, toggles, ScreenDimensions |
| `docs/sessions/sessions-planned-index.md` | Open plans for upcoming sessions |

# Workspace Dashboard App

Next.js 16 + React 19 + Tailwind 4 web app for browsing Claude Code sessions from `~/.claude/`.

## Dev

```
npm run dev   # http://localhost:3000
```

## What this is

- Reads `.claude/projects/<slug>/*.jsonl` for session transcripts
- Reads `.claude/sessions/*.json` for active sessions
- Stores read-state in `.claude/dashboard-read.json`
- Dark theme (zinc-900/950), no auth, local only

## Slug format

Claude encodes paths as slugs: `:` → `-`, path separators → `-`.  
`c:\work\git\foo` → `c--work-git-foo`  
Decoding is best-effort (hyphens in folder names are indistinguishable from separators).
