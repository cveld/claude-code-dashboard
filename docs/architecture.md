# Architecture

## Routing

| Route | Bestand | Inhoud |
|---|---|---|
| `/` | `app/page.tsx` | Projectenlijst met unread markers |
| `/sessions` | `app/sessions/page.tsx` | Sessies gegroepeerd op tijdperiode, collapsible, met All/Unread toggle en Mark read/unread per groep |
| `/projects/[slug]` | `app/projects/[slug]/page.tsx` | Sessies van één project, met per-sessie Mark read/unread knop |
| `/projects/[slug]/sessions/[id]` | `app/projects/[slug]/sessions/[id]/page.tsx` | Volledig transcript |

Navigatie via `DashboardNav` met `Link` + `usePathname` — geen `viewMode` state, de URL is de bron van waarheid.

## Gedeelde code

| Bestand | Inhoud |
|---|---|
| `app/lib/dashboard.ts` | Types + utils: `isUnread`, `timeAgo`, `topSegment` |
| `app/lib/useDataRefresh.ts` | Hook: SSE-verbinding + debounce → `onRefresh` callback |
| `app/components/DashboardNav.tsx` | Tab-balk + project-filter pills. Props: `projects`, `unreadCount?`, `projectFilter`, `onFilterChange` |

Elke page-route fetcht zijn eigen data. Geen gedeelde server state.

## API routes

| Route | Method | Doel |
|---|---|---|
| `/api/projects` | GET | Alle projecten met slug, displayPath, sessionCount, lastActivity |
| `/api/sessions` | GET | Alle sessies over alle projecten, gesorteerd op mtime. `?limit=N` (max 500, default 100), `?project=slug` voor filter. |
| `/api/projects/[slug]/sessions` | GET | Sessies van één project |
| `/api/projects/[slug]/sessions/[id]` | GET | Volledig transcript als `{ messages: TranscriptMessage[] }` |
| `/api/read-state` | GET/POST | Leest/schrijft `.claude/dashboard-read.json`. POST: `{ slug }` of `{ slugs: string[], unread?: boolean }` voor bulk. `unread: true` verwijdert de key. |
| `/api/events` | GET (SSE) | Stuurt `change` event bij `.jsonl`-wijziging in `~/.claude/projects/`. Heartbeat comment elke 30s. |

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
- Verschijnen on-hover: `opacity-0 group-hover:opacity-100`
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

`useDataRefresh(onRefresh)` opent een `EventSource` op `/api/events`. Bij elk `change` event wordt `onRefresh` aangeroepen na 1 seconde debounce (voorkomt storm bij snelle writes).

De SSE route opent `fs.watch` op `~/.claude/projects/` met `{ recursive: true }`. Cleanup via `req.signal` `abort` event.

Pages die dit gebruiken: `app/page.tsx`, `app/sessions/page.tsx`.
