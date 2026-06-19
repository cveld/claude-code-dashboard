# Claude Code Dashboard

Lokale web-app om Claude Code sessies te browsen vanuit `~/.claude/`. Gebouwd met Next.js 16, React 19 en Tailwind 4.

## Starten

```bash
npm run dev   # http://localhost:3000
```

## Features

- **Projectenoverzicht** — alle projecten met unread-markers en last-activity
- **Sessiesbrowser** — sessies over alle projecten, gegroepeerd op tijdperiode (Today, Yesterday, This week, …), collapsible groepen
- **Transcriptviewer** — volledig transcript met Markdown-rendering (tabellen, code blocks, GFM)
- **Inline tail preview** — klap de laatste N berichten uit zonder de transcriptpagina te openen; "Load more" laadt telkens 10 berichten bij
- **Unread tracking** — blauw bolletje per sessie; bulk mark read/unread per groep; optioneel auto-mark bij openen (instelbaar)
- **Realtime updates** — SSE-verbinding detecteert wijzigingen in `~/.claude/projects/` en ververst de pagina automatisch
- **Project-filter pills** — filter op het eerste padsegment van het projectpad
- **Sort toggle** — nieuwste of oudste eerst, persistent via `localStorage`
- **Actieve sessies** — leest `~/.claude/sessions/*.json` voor lopende Claude-processen
- **IDE-vensterdetectie** — leest `~/.claude/ide/*.lock` om open IDE-vensters te tonen; kan een bestand openen in de juiste IDE
- **Hook-ontvanger** — POST `/api/hooks` vanuit Claude Code hooks (stop, notification) triggert realtime meldingen in de dashboard

## Pagina's

| URL | Inhoud |
|---|---|
| `/` | Projectenlijst met unread-count en last-activity |
| `/sessions` | Alle sessies gegroepeerd op tijdperiode, All/Unread toggle, inline tail expand |
| `/projects/[slug]` | Sessies van één project met mark read/unread per sessie |
| `/projects/[slug]/sessions/[id]` | Volledig transcript |
| `/settings` | App-instellingen (o.a. auto-mark-as-read) |

## Data

De app leest uitsluitend lokale bestanden — er is geen authenticatie en geen externe server.

| Bestand | Gebruik |
|---|---|
| `~/.claude/projects/<slug>/*.jsonl` | Sessie-transcripten |
| `~/.claude/sessions/*.json` | Actieve Claude-processen |
| `~/.claude/ide/*.lock` | Open IDE-vensters |
| `~/.claude/dashboard-read.json` | Read-state (wordt bijgehouden door de app) |
| `~/.claude/dashboard-settings.json` | App-instellingen |

### Slug-formaat

Claude encodeert paden als slug: `:` → `-`, path-separators → `-`.  
`c:\work\git\foo` → `c--work-git-foo`

## Claude Code hooks instellen

Voeg onderstaande toe aan je `~/.claude/settings.json` om stop- en notificatie-events door te sturen naar het dashboard:

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
