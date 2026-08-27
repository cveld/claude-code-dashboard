# Claude Code Dashboard

A local web app for browsing Claude Code sessions from `~/.claude/`. Built with Next.js 16, React 19, and Tailwind 4.

## Run it

No clone, no install — just run it with `npx`:

```bash
npx @cveld/claude-code-dashboard          # http://localhost:3000
npx @cveld/claude-code-dashboard -p 4000  # custom port
```

It reads from your local `~/.claude/` directory. Open the printed URL in your browser.

### Optional: register with a local Caddy server

If you run [Caddy](https://caddyserver.com/) locally with its admin API enabled, the CLI can pick
a free port and register a route for you. Registering mutates a Caddy config this package does
not own, so for `npx` it is opt-in and never required to run the dashboard:

```bash
npx @cveld/claude-code-dashboard --caddy   # http://claude-code-dashboard.localhost
```

The route is removed again when the process exits. Configure it with flags or environment
variables (flags win when both are set):

| Flag | Env var | Default |
|---|---|---|
| `--caddy` / `--no-caddy` | `CLAUDE_DASHBOARD_CADDY=1` / `=0` | off for `npx`, on for `npm run dev` |
| `--caddy-host=<host>` | `CLAUDE_DASHBOARD_CADDY_HOST` | `claude-code-dashboard.localhost` |
| `--caddy-admin=<url>` | `CLAUDE_DASHBOARD_CADDY_ADMIN` | `http://127.0.0.1:2019` |
| `--caddy-dial-host=<host>` | `CLAUDE_DASHBOARD_CADDY_DIAL_HOST` | auto-detected |
| — | `CADDY_SERVER_NAME` | first server found in Caddy's config |

If Caddy isn't running or the admin API is unreachable, the launcher says so in one line and
starts the dashboard normally — Caddy is never a requirement.

The upstream host is auto-detected. When Caddy itself runs in Docker, `127.0.0.1` resolves
inside the container rather than on your host and the route answers `502`; the launcher notices
that on its first request through Caddy and re-points the route at `host.docker.internal`.
Setting `--caddy-dial-host=<host>` explicitly turns the detection off.

## Development

```bash
npm install
npm run dev         # http://localhost:3000 + http://claude-code-dashboard.localhost
npm run dev:plain   # bare `next dev`, no Caddy
```

`npm run dev` registers the Caddy route on your behalf and drops it again on exit. It pins the
port (3000 when free, otherwise a free one) so the route can never point at a port Next didn't
get. Opt out with `npm run dev -- --no-caddy` or `CLAUDE_DASHBOARD_CADDY=0`.

Any hostname the dev server is reached under must also be listed in `allowedDevOrigins` in
`next.config.ts`, otherwise Next blocks the dev-only asset requests.

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

## Windows tray app

Optional companion app: `windows-tray/ClaudeTokenTray`, a standalone .NET / WinUI 3 project. It
lives alongside the Next.js app, is not published or referenced by it, and runs independently of
`npm run dev`.

It shows Claude usage-quota utilization (5h, 7d, 7d Sonnet) continuously in the Windows system
tray. It reads the OAuth token from `~/.claude/.credentials.json` and polls the Anthropic usage
endpoint every 5 minutes; "Refresh now" in the context menu forces a poll. Hovering the icon
shows a tooltip with one bar per usage window — percentage and reset time — plus RAM and paged
memory for the active Claude Code sessions.

Two icon styles are switchable from the right-click menu: **Number** (colored circle with the 5h
percentage) and **Bars** (two vertical meters, 5h and 7d). The choice is persisted in the
registry. The menu also has a "Start with Windows" toggle.

Build and run on Windows with the .NET SDK installed:

```bash
npm run tray   # dotnet run --project windows-tray/ClaudeTokenTray

# or directly:
cd windows-tray/ClaudeTokenTray
dotnet build
dotnet run   # launches straight to the tray, no window
```

If a previous instance is still running in the tray — including one auto-started by "Start with
Windows" — the build fails with `MSB3027` because `ClaudeTokenTray.exe` is locked. Stop it first:

```powershell
Get-Process ClaudeTokenTray | Stop-Process -Force
```

See [docs/windows-tray.md](docs/windows-tray.md) for structure and implementation details.
