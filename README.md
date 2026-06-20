# Claude Code Dashboard

A local web app for browsing Claude Code sessions from `~/.claude/`. Built with Next.js 16, React 19, and Tailwind 4.

## Run it

No clone, no install — just run it with `npx`:

```bash
npx @cveld/claude-code-dashboard          # http://localhost:3000
npx @cveld/claude-code-dashboard -p 4000  # custom port
```

It reads from your local `~/.claude/` directory. Open the printed URL in your browser.

## Development

```bash
npm install
npm run dev   # http://localhost:3000
```

## Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please).
Push [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …) to
`main`; release-please opens a release PR that bumps the version and updates `CHANGELOG.md`.
Merging that PR tags a GitHub release and the workflow publishes the package to npm
with [provenance](https://docs.npmjs.com/generating-provenance-statements).

> Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
> (OIDC) — no `NPM_TOKEN` secret. Configure the trusted publisher once on npmjs.com for
> `@cveld/claude-code-dashboard`: GitHub repo `cveld/claude-code-dashboard`, workflow
> `release-please.yml`. The package must already exist, so the very first version is
> published manually (`npm publish --access public`).

## Features

- **Projects overview** — all projects with unread markers and last-activity timestamps
- **Sessions browser** — sessions across all projects, grouped by time period (Today, Yesterday, This week, …), with collapsible groups
- **Transcript viewer** — full transcript with Markdown rendering (tables, code blocks, GFM)
- **Inline tail preview** — expand the last N messages without leaving the sessions list; "Load more" adds 10 messages at a time
- **Unread tracking** — blue dot per session; bulk mark read/unread per group; optional auto-mark on open (configurable)
- **Real-time updates** — SSE connection detects changes in `~/.claude/projects/` and refreshes automatically
- **Project filter pills** — filter by the first path segment of the project path
- **Sort toggle** — newest or oldest first, persisted via `localStorage`
- **Active sessions** — reads `~/.claude/sessions/*.json` for running Claude processes
- **IDE window detection** — reads `~/.claude/ide/*.lock` to show open IDE windows; can open a file directly in the right IDE
- **Hook receiver** — POST `/api/hooks` from Claude Code hooks (stop, notification) triggers real-time notifications in the dashboard

## Pages

| URL | Content |
|---|---|
| `/` | Projects list with unread count and last activity |
| `/sessions` | All sessions grouped by time period, All/Unread toggle, inline tail expand |
| `/projects/[slug]` | Sessions for one project with per-session mark read/unread |
| `/projects/[slug]/sessions/[id]` | Full transcript |
| `/settings` | App settings (e.g. auto-mark-as-read) |

## Data

The app reads local files only — no authentication, no external server.

| File | Purpose |
|---|---|
| `~/.claude/projects/<slug>/*.jsonl` | Session transcripts |
| `~/.claude/sessions/*.json` | Active Claude processes |
| `~/.claude/ide/*.lock` | Open IDE windows |
| `~/.claude/dashboard-read.json` | Read state (managed by the app) |
| `~/.claude/dashboard-settings.json` | App settings |

### Slug format

Claude encodes paths as slugs: `:` → `-`, path separators → `-`.  
`c:\work\git\foo` → `c--work-git-foo`

## Setting up Claude Code hooks

Add the following to `~/.claude/settings.json` to forward stop and notification events to the dashboard:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:3000/api/hooks -H 'Content-Type: application/json' -d '{\"event\":\"stop\",\"transcriptPath\":\"$CLAUDE_TRANSCRIPT_PATH\",\"sessionId\":\"$CLAUDE_SESSION_ID\"}'"
          }
        ]
      }
    ]
  }
}
```
