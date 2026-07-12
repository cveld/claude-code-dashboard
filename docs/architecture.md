# Architecture

## Routing

| Route | Bestand | Inhoud |
|---|---|---|
| `/` | `app/page.tsx` | Projectenlijst met unread markers + IDE-window badge |
| `/sessions` | `app/sessions/page.tsx` | Sessies gegroepeerd op tijdperiode, collapsible, met All/Unread toggle, List/Split layout en Mark read/unread per groep |
| `/settings` | `app/settings/page.tsx` | Toggle-instellingen (`autoMarkAsRead`) |
| `/projects/[slug]` | `app/projects/[slug]/page.tsx` | Sessies van één project, met per-sessie Mark read/unread knop |
| `/projects/[slug]/sessions/[id]` | `app/projects/[slug]/sessions/[id]/page.tsx` | Volledig transcript (rendert `TranscriptPanel`) |
| `/gallery` | `app/gallery/page.tsx` | Dev-only — wikkelt alleen `ResponsiveViewer`. Retourneert 404 in production. |
| `/gallery/components` | `app/gallery/components/page.tsx` | Dev-only — standalone fixture-pagina (status indicators + session tiles). Geen nav, geschikt als iframe-target in de viewer. Retourneert 404 in production. |
| `/processes` | `app/processes/page.tsx` | Overzicht van alle actieve Claude Code processen (pid, sessionId, cwd, memory RAM/paged, startedAt, version, entrypoint). Klikbaar via `MemoryUsageBadge` in de header. |

Schermen + opties per route staan in `screens.md`.

Navigatie via `DashboardNav` met `Link` + `usePathname` — geen `viewMode` state, de URL is de bron van waarheid.

## Gedeelde code

| Bestand | Inhoud |
|---|---|
| `app/lib/dashboard.ts` | Types + utils: `isUnread`, `timeAgo`, `topSegment` |
| `app/lib/useDataRefresh.ts` | Hook: SSE-verbinding + debounce → `onRefresh` callback |
| `app/components/DashboardNav.tsx` | Tab-balk + project-filter pills. Props: `projects`, `unreadCount?`, `projectFilter`, `onFilterChange` |
| `app/components/TokenUsageBadge.tsx` | Compact token-usage badge rechts in de nav. Pollt `/api/token-usage` slim (op reset-moment). Toont alleen niet-null windows. |
| `app/components/ScreenDimensions.tsx` | Dev-only: fixed overlay top-right met `window.innerWidth × window.innerHeight`. Gerenderd in root layout alleen als `NODE_ENV === 'development'`. |

Elke page-route fetcht zijn eigen data. Geen gedeelde server state.

## API routes

| Route | Method | Doel |
|---|---|---|
| `/api/projects` | GET | Alle projecten met slug, displayPath, sessionCount, lastActivity |
| `/api/sessions` | GET | Alle sessies over alle projecten, gesorteerd op mtime. `?limit=N` (max 500, default 100), `?project=slug` voor filter. |
| `/api/projects/[slug]/sessions` | GET | Sessies van één project |
| `/api/projects/[slug]/sessions/[id]` | GET | Volledig transcript als `{ messages: TranscriptMessage[] }` |
| `/api/projects/[slug]/sessions/[id]/stats` | GET | Token/context-stats voor `StatsBar` (`currentContext`, `totalOutputTokens`, cache, `assistantTurns`, `contextWindowSize`) |
| `/api/read-state` | GET/POST | Leest/schrijft `.claude/dashboard-read.json`. POST: `{ slug }` of `{ slugs: string[], unread?: boolean }` voor bulk. `unread: true` verwijdert de key. |
| `/api/settings` | GET/POST | Leest/schrijft `~/.claude/dashboard-settings.json`. Bevat `autoMarkAsRead`. |
| `/api/claude-settings/hooks` | GET | Read-only: parseert `hooks` uit `~/.claude/settings.json` → platte lijst `{ event, matcher?, type, shell?, command }[]`. Getoond op `/settings` als "Configured hooks" sectie met dashboard-badge (command bevat `/api/hooks`, `session-start-hook.ps1` of `monitor-start.sh`) en ✓ configured badges op de setup-snippets. |
| `/api/active-sessions` | GET | Live sessies uit `~/.claude/sessions/*.json` (pid, sessionId, cwd, startedAt, …) |
| `/api/ide-windows` | GET | Draaiende IDE-vensters uit `~/.claude/ide/*.lock` (alleen levend PID). authToken weggelaten. |
| `/api/ide-windows/open-file` | POST | `{ port, filePath }` → opent file via MCP-`openFile` over WS + brengt venster naar voorgrond (Windows). |
| `/api/token-usage` | GET | Leest `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`, roept `https://api.anthropic.com/api/oauth/usage` aan (header `anthropic-beta: oauth-2025-04-20`). Server-side cache 5 min. Geeft `{ five_hour, seven_day, seven_day_sonnet }` terug, elk `{ utilization: number, resets_at: string\|null } \| null`. |
| `/api/hooks` | POST | Ontvangt Claude-Code hook (`stop`/`notification`), emit op in-memory `hookEmitter`. |
| `/api/events` | GET (SSE) | Stuurt `change` event bij `.jsonl`-wijziging in `~/.claude/projects/`, én `hook` events uit `hookEmitter`. Heartbeat comment elke 30s. |
| `/api/sessions/[id]/send-message` | POST | Schrijft `{ message }` als JSON-regel naar `~/.claude/sessions/<id>-inbox.jsonl`. Keert terug `{ ok: true }`. |
| `/api/monitor-active-sessions` | GET | Geeft `string[]` terug van session-IDs waarvoor `~/.claude/sessions/<id>-monitor.ready` bestaat. |

## Data types

Canonieke locatie: `app/lib/dashboard.ts`

```ts
ProjectInfo         { slug, displayPath, sessionCount, lastActivity }
SessionInfo         { id, title, startedAt, messageCount, firstUserMessage, lastActivity }
SessionWithProject  { ...SessionInfo, projectSlug, projectDisplayPath }   // /api/sessions
TranscriptMessage   { type, text, timestamp, uuid }
```

## peekJsonl

Gedeeld patroon in `/api/projects/[slug]/sessions/route.ts` én `/api/sessions/route.ts`.  
Leest een `.jsonl` regel voor regel, pakt: `startedAt` (eerste timestamp), `ai-title` / `custom-title`, eerste user message (max 120 chars). Als je dit aanpast, pas beide bestanden aan (of extraheer naar `lib/peekJsonl.ts`).

## Project filter

Filter-pills in `DashboardNav` filteren op het eerste padsegment van `displayPath` (`topSegment()`).  
Filter-state is lokaal per pagina — reset bij tab-navigatie. Geen URL-param.

## Sort order

Alle lijstpagina's hebben een "↓ Newest first / ↑ Oldest first" toggle knop.

- Sortering gebeurt **client-side** door de al gesorteerde API-data om te draaien (`[...arr].reverse()`).
- Op `/sessions` worden zowel de **groepvolgorde** als de **sessies binnen elke groep** omgedraaid.
- Voorkeur wordt opgeslagen in `localStorage["sort-asc"]` — **gedeeld** over alle pagina's, persistent over browser-herstarts.
- State initialisatie: `useState(() => typeof window !== "undefined" && localStorage.getItem("sort-asc") === "true")`

## Unread indicators

- **Blauw bolletje** — sessie is ongelezen: `lastActivity > readState[projectSlug/sessionId]`
- Read state key is `projectSlug/sessionId` — niet alleen project-slug.
- POST naar `/api/read-state` bij openen van een sessie (transcript-pagina).
- Unread count in de Sessions tab: berekend in `sessions/page.tsx` en doorgegeven als `unreadCount` prop.
- Bulk mark read/unread: `POST /api/read-state` met `{ slugs: string[], unread?: boolean }`.

### Per-sessie Mark read/unread knop

Beide lijstpagina's (`/sessions` en `/projects/[slug]`) hebben per-sessie knoppen:
- Verschijnen on-hover: `opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100`
- `[@media(hover:none)]` zorgt dat ze op touch-apparaten altijd zichtbaar zijn (geen hover-event beschikbaar)
- Knop staat **buiten** de `<Link>` — de outer div heeft `group hover:bg-zinc-800`
- Structuur in `app/projects/[slug]/page.tsx`:
  ```
  <div class="group hover:bg-zinc-800">        ← hover-target
    <Link ...>dot + content</Link>             ← navigeert
    <div>                                      ← rechts, buiten Link
      <button onClick={markSession}>Mark read/unread</button>
      stats (messageCount, timeAgo, ctxPct)
    </div>
  </div>
  ```
- `markSession(sessionKey, unread)` POST naar `/api/read-state` met `{ slugs, unread }` en update lokale state optimistisch.

## Sessions groepering (`/sessions`)

Sessies zijn gegroepeerd op rolling window in `app/sessions/page.tsx` (`getTimeLabel()` + `groupSessions()`):

| Label | Bereik |
|---|---|
| Today | Vandaag (calendar day) |
| Yesterday | Gisteren (calendar day) |
| This week | 2–7 dagen geleden |
| Last week | 8–14 dagen geleden |
| This month | 15–30 dagen geleden |
| Last month | 31–60 dagen geleden |
| Maandnaam | Ouder |

Rolling window — geen vaste maandaggrens. Groepen zijn collapsible (`collapsed: Set<string>` state).

## Tail expand (inline preview in `/sessions`)

Sessies in `/sessions` hebben een uitklap-knop die de laatste N berichten toont zonder naar de transcriptpagina te gaan.

**State in `app/sessions/page.tsx`:**

| State | Type | Doel |
|---|---|---|
| `expandedSessions` | `Set<string>` | Welke sessies zijn uitgevouwen (key = `projectSlug/sessionId`) |
| `tailCache` | `Record<string, TailMessage[]>` | Gecachede berichten per sessie-key |
| `tailSize` | `Record<string, number>` | Huidige tail-grootte per sessie (default 5, +10 per "Load more") |

**Laden:** `fetchTail(key, slug, id, size)` roept `GET /api/projects/[slug]/sessions/[id]?tail=N` aan. De API retourneert de laatste N berichten.

**"Load more" balk:** verschijnt boven de berichten als `tailSize[key] < s.messageCount`. Elke klik laadt 10 berichten extra (max = `messageCount`).

**Rendering:** berichten worden gerenderd via `ReactMarkdown` + `remarkGfm` met `prose prose-xs prose-invert` classes — geen karakter-truncatie per bericht.

**Message UUID:** elk `TranscriptMessage` heeft een optioneel `uuid` veld (`app/api/projects/[slug]/sessions/[id]/route.ts`). Kan gebruikt worden voor deep links naar specifieke berichten in de transcript-pagina.

## Markdown rendering

Beide plekken waar berichttekst wordt getoond gebruiken `ReactMarkdown` + `remarkGfm`:

| Plek | Bestand | Prose-klassen |
|---|---|---|
| Volledig transcript | `app/projects/[slug]/sessions/[id]/page.tsx` | `prose-sm` |
| Tail expand preview | `app/sessions/page.tsx` | `prose-xs` (kleiner) |

Tabellen in het volledige transcript krijgen custom `components` (scrollable wrapper, border-styling).

## Real-time updates (SSE)

`useDataRefresh(onRefresh, onHookEvent?)` opent een `EventSource` op `/api/events`. Bij elk `change` event wordt `onRefresh` aangeroepen na **2 seconden** debounce. Bij een `hook` event wordt `onHookEvent` aangeroepen met de geparste `HookEvent`.

De SSE route opent `fs.watch` op `~/.claude/projects/` met `{ recursive: true }` én luistert op `hookEmitter` voor hook-events. Cleanup via `req.signal` `abort` event.

Pages die dit gebruiken: `app/page.tsx`, `app/sessions/page.tsx` (laatste ook met `onHookEvent`).

### ChangeEvent payload

Het `change` event stuurt `{ slug, sessionId }` mee (beide `string | null`):

```ts
export interface ChangeEvent {
  slug: string | null;       // eerste path-segment van de gewijzigde .jsonl
  sessionId: string | null;  // bestandsnaam zonder .jsonl extensie
}
```

`onRefresh` ontvangt dit als optionele parameter: `(change?: ChangeEvent) => void`. Bij initial load is `change` `undefined`.

### Gerichte refresh-strategie

Pages gebruiken `change` om onnodig werk te vermijden:

| Data | Initial load | Bij change event |
|---|---|---|
| `/api/projects` | ✓ | ✓ altijd |
| `/api/sessions?project=<slug>` | Alle sessies | Alleen gewijzigd project; client merget terug |
| `/api/read-state` | ✓ | ✗ skip — wijzigt alleen via eigen POST |
| `/api/ide-windows` | ✓ | ✗ skip — los `setInterval(30s)` in `app/page.tsx` |
| Transcript + stats | ✓ | Alleen als `change.sessionId === id` |

**Merge-patroon** (home + sessions page):
```ts
setSessions(prev => {
  const others = prev.filter(s => s.projectSlug !== change.slug);
  return [...others, ...newProjectSessions].sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
});
```

### Refresh counter

`DashboardNav` accepteert een optionele `refreshCount?: number` prop. Pages tracken dit via `useState` en incrementeren bij elke live refresh (niet bij initial load). Getoond als `↺ N` in de tab-balk — zichtbaar wanneer `> 0`.

## Hook-events

Claude-Code hooks POSTen naar `/api/hooks`. De route bouwt een `HookEvent` (`type: "stop"|"notification"|"permission"`, `sessionId`, `projectSlug`, `message?`, `title?`, `tool?`, `timestamp`) en doet `hookEmitter.emit("hook", event)`. De emitter is een globalThis-singleton (`app/lib/hookEvents.ts`) zodat hij hot-reload en route-isolatie overleeft. `/api/events` relayed het naar de browser; `/sessions` en `/projects/[slug]` tonen een badge (groen vinkje=stop, amber bel=notification, rood vraagteken=permission) + browser-`Notification`. De `permission`-badge pulseert en de sessie-tile krijgt een rode highlight (`bg-red-950/40 ring-1 ring-red-500/50`) zolang de sessie ongelezen is — gevoed door de `PermissionRequest`-hook (`tool_name` → `tool` veld). Zie `screens.md`.

## Send message to session

Altijd actief (geen feature flag). Beschikbaar in list-mode van `/sessions` én in `TranscriptPanel`.

**Send → modal (list-mode):**
1. User klikt "Send →" (on-hover op sessie-tile)
2. Modal toont sessietitel, session-GUID, en Step 1: Monitor tool call + Step 2: textarea
3. POST `/api/sessions/[id]/send-message` → schrijft naar `~/.claude/sessions/<id>-inbox.jsonl`
4. Response (of fout) getoond in modal

**Monitor setup:** `app/lib/monitorToolCall.ts` genereert de JSON voor het Monitor-tool call dat Claude Code moet uitvoeren. Maakt `<id>-inbox.jsonl` en `<id>-monitor.ready` aan; verwijdert `.ready` bij exit.

**Monitor active check:** `GET /api/monitor-active-sessions` (`app/api/monitor-active-sessions/route.ts`) geeft array van session-IDs terug waarvoor een `.ready`-bestand bestaat. Wordt elke 10s gepolled door `sessions/page.tsx` en `TranscriptPanel`. Groene dot = monitor actief.

**TranscriptPanel send-paneel:** onderaan het transcript, altijd zichtbaar. Als monitor actief: inline textarea + Send knop. Als niet actief: "No monitor running" + "Setup monitor →" knop (opent modal met de Monitor tool call).

Bestanden: `app/api/sessions/[id]/send-message/route.ts`, `app/api/monitor-active-sessions/route.ts`, `app/lib/monitorToolCall.ts`

## IDE-windows

`app/lib/ideWindows.ts` leest `~/.claude/ide/*.lock` en filtert op levend PID (`process.kill(pid,0)`). `findIdeWindowForSlug` (in `dashboard.ts`) matcht een venster op project-slug via `pathToSlug(workspaceFolder)`. Open-file gaat via MCP `openFile` over WebSocket met auth-token uit de lock; op Windows wordt het venster ook naar voren gehaald via PowerShell `SetForegroundWindow`.
