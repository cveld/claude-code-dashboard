# Schermen & opties

Overzicht van elk scherm, wat het toont en welke controls/opties beschikbaar zijn. Voor data-types, API-contracten en patronen zie `architecture.md`.

Tabs (in `DashboardNav`): **Projects** (`/`), **Sessions** (`/sessions`), **Settings** (`/settings`). De Sessions-tab toont een blauw unread-getal als `unreadCount > 0`. Rechts in de balk (`ml-auto`): **`TokenUsageBadge`** — mini-progressbars voor actieve rate-limit windows (5h/7d/7d-Sonnet). Kleur: blauw < 70%, amber < 90%, rood ≥ 90%. Hover toont reset-countdown. Toont alleen windows die de API als niet-`null` teruggeeft.

## Projects (`/`)

`app/page.tsx` — lijst van projecten.

| Element | Gedrag |
|---|---|
| Project-rij | Link naar `/projects/[slug]`. Toont `displayPath`, `slug`, `sessionCount`, `timeAgo(lastActivity)` |
| Blauw bolletje | Project heeft unread activiteit (`lastActivity > readState[slug]`) — let op: **project-level** key, niet `slug/sessionId` |
| Mark read/unread | On-hover knop (`opacity-0 group-hover:opacity-100`), optimistische update + POST `/api/read-state` |
| **VS**-badge | Verschijnt als er een live IDE-window matcht (`findIdeWindowForSlug`). Klik → POST `/api/ide-windows/open-file` → brengt IDE naar voorgrond. Zie [IDE-windows](#ide-windows) |

**Opties:** sort toggle (`↓ Newest first / ↑ Oldest first`, gedeeld via `localStorage["sort-asc"]`), project-filter pills (alleen als >1 root-segment).

## Sessions (`/sessions`)

`app/sessions/page.tsx` — alle sessies over alle projecten. Twee layout-modi.

### Controls bar (gedeeld tussen beide modi)

| Control | Opties | Persistentie |
|---|---|---|
| Sort toggle | Newest / Oldest first | `localStorage["sort-asc"]` (gedeeld) |
| All / Unread filter | Toont alles of alleen unread | `sessionStorage["sessions-unread-only"]` |
| Layout toggle | List / Split (icons) | `localStorage["sessions-layout"]` |

### List-modus (default)

Sessies gegroepeerd op rolling window (Today/Yesterday/This week/…), groepen collapsible. Per groep: Mark read / Mark unread. Per sessie: unread-dot, tail-expand preview (laatste N berichten inline), per-sessie Mark read/unread, copy session-id, **Send →** (on-hover). FLIP-animatie bij herordening, `session-updated` pulse bij wijziging (zie `app/globals.css`). Detail in `architecture.md`.

### Split-modus

Layout: `h-screen` root, **sticky top-bar** (`shrink-0` met nav + controls), daaronder twee onafhankelijk scrollende kolommen.

| Kolom | Breedte | Scroll | Inhoud |
|---|---|---|---|
| Links | `w-72 shrink-0` | eigen `overflow-y-auto` | Compacte sessie-lijst (`splitSessionList`), gegroepeerd + collapsible. Klik selecteert → URL-params `?slug=&id=` |
| Rechts | `flex-1` | `TranscriptPanel` scrollt intern | Transcript van geselecteerde sessie, of placeholder |

- **Selectie-state staat in de URL** (`?slug=&id=`), niet in component-state — deelbaar/refreshbaar.
- Geselecteerde rij: `bg-zinc-700`. Sessie-dot: groen/amber bij hook-event, anders blauw bij unread.
- **Kritieke layout-eis:** de split-root moet een bounded hoogte hebben (`h-screen`), anders werken de aparte scrollbars niet — de body is `min-h-full flex flex-col`, dus `flex-1` alleen geeft géén bounded hoogte. Zie ook `gotchas.md`.

## Transcript (`/projects/[slug]/sessions/[id]` én `TranscriptPanel`)

`app/components/TranscriptPanel.tsx` — herbruikt in split-modus én op de losse transcript-pagina.

- Eigen sticky header (`shrink-0`): titel, project-link, session-id + copy-knop, **VS**-knop (als een IDE-window matcht, `findIdeWindowForSlug` → focus IDE), Mark as read/unread, `StatsBar`.
- `StatsBar`: context-bar (kleur schaalt met %), output-tokens, cache-hit %, assistant-turns. Data uit `/api/projects/[slug]/sessions/[id]/stats`.
- **Sticky gebruikersvraag:** direct onder de header zit een strip die de meest recente gebruikersbericht toont die boven het scherm is gescrolld. Zelfde opmaak als gewone user-ballonnen (blue-900, max-w-[85%], avatar rechts). Verdwijnt als de vraag weer zichtbaar is. Implementatie via scroll-event + `getBoundingClientRect` op user-message elementen (`userMsgRefs` map, geïndexeerd op berichtindex). Pulse-animatie (shadow) bij contextwissel.
- Berichten scrollen in eigen `flex-1 overflow-y-auto`. Auto-scroll naar bodem bij open en bij nieuwe berichten als je near-bottom was.
- Auto-mark-as-read bij open **alleen als** `settings.autoMarkAsRead` aan staat; anders handmatig via de knop.

## Gallery (`/gallery`)

`app/gallery/page.tsx` — dev-only server component. Retourneert 404 als `NODE_ENV === "production"`.

Bedoeld voor visuele validatie na styling-wijzigingen en als basis voor Playwright-screenshots (`node scripts/screenshot.mjs /gallery`).

Toegankelijk via **Settings → Developer → Open gallery →**.

Twee secties met fixture-tiles (hardcoded data, geen fetch):

| Sectie | Fixtures |
|---|---|
| Status indicators | Unread (blauw bolletje), Read, Unread + completed (groen vinkje), Read + completed (grijs vinkje), Notification (amber bell) |
| Session tiles | Monitor active (groene dot op Send-knop), Context low 30% (blauwe balk), Context high 80% (oranje), Context critical 95% (rood), Long title (truncatie) |

Elke tile toont dezelfde Tailwind-classes als de echte sessie-tile in `app/sessions/page.tsx` — knoppen zijn zichtbaar maar niet klikbaar (geen handlers).

## Settings (`/settings`)

`app/settings/page.tsx` — drie secties: Settings, Setting up hooks, Developer, About.

### Settings
Leest/schrijft `/api/settings` (`~/.claude/dashboard-settings.json`).

### Developer

| Link | Doel |
|---|---|
| Open gallery → | Navigeert naar `/gallery` (altijd zichtbaar; route zelf geeft 404 in production) |

| Optie | Default | Effect |
|---|---|---|
| Auto-mark as read on open | `false` | Aan: transcript openen markeert automatisch als gelezen. Uit: gebruik de Mark as read-knop |

## IDE-windows

Detectie van draaiende Claude-Code IDE-vensters via lock-files in `~/.claude/ide/*.lock` (`app/lib/ideWindows.ts`). Alleen vensters met een levend PID (`process.kill(pid, 0)`).

- `GET /api/ide-windows` → `{ port, workspaceFolders, pid, ideName }[]` (authToken weggelaten).
- `POST /api/ide-windows/open-file` `{ port, filePath }` → opent file via MCP-`openFile` over WebSocket (`ws://127.0.0.1:port`, auth-header uit lock). Op Windows brengt het ook het IDE-venster naar de voorgrond via PowerShell `SetForegroundWindow`.
- Match project↔venster: `findIdeWindowForSlug` vergelijkt `pathToSlug(workspaceFolder)` met de project-slug.

## Hook-notificaties

Claude-Code hooks POSTen naar `POST /api/hooks` (`{ event: "stop"|"notification", sessionId, transcriptPath, message, title }`). De route emit een `HookEvent` op de in-memory `hookEmitter`; `/api/events` (SSE) stuurt die door als `hook`-event.

- `useDataRefresh(onRefresh, onHookEvent?)` levert hook-events aan de client.
- In `/sessions` zet `handleHookEvent` een dot per sessie (groen = `stop`, amber = `notification`) en toont een browser-`Notification` (permission wordt bij load gevraagd).
