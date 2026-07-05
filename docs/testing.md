# Testing

## E2E tests (Playwright)

```
npx playwright test          # headless
npx playwright test --ui     # interactief
```

Config: `playwright.config.ts` — baseURL `http://localhost:3000`, geen autostart van de dev server. Start die zelf eerst met `npm run dev`.

Specs staan in `e2e/`. Huidig:

| Spec | Doel |
|---|---|
| `e2e/sessions-layout-toggle.spec.ts` | List/split layout toggle, persistentie, tail-expand zichtbaarheid |
| `e2e/permission-highlight.spec.ts` | POST't een gesimuleerd `PermissionRequest`-hook-event (`event: "permission"`) naar `/api/hooks` voor de meest recente sessie en checkt de rode ring + "Permission needed"-badge op `/sessions`. Snapshot/restore van `~/.claude/dashboard-hook-events.json` in `beforeEach`/`afterEach` — dit bestand wordt ook door de echte dashboard-instance gebruikt. |

## Playwright output (`test-results/`)

Gegenereerd door Playwright, staat in `.gitignore`.

| Bestand | Inhoud |
|---|---|
| `.last-run.json` | Status van de laatste testrun (`passed` / `failed` + gefaalde test-IDs) |
| `*.png` | Schermafbeeldingen expliciet opgeslagen via `page.screenshot()` in specs of losse scripts |

Playwright schrijft hier standaard zijn artifacts naartoe. Als je `toHaveScreenshot()` gebruikt worden visuele basislijnen opgeslagen in `e2e/__snapshots__/` (naast de spec) en diffs in `test-results/`.

## Handmatige screenshots (`screenshots/`)

Gegenereerd door `scripts/screenshot.mjs`, staat in `.gitignore`.

```
node scripts/screenshot.mjs <route-of-url> [opties]
```

Handige opties:

| Optie | Default | Effect |
|---|---|---|
| `--out <pad>` | `screenshots/shot.png` | Uitvoerbestand |
| `--layout list\|split` | — | Pre-seed `localStorage["sessions-layout"]` |
| `--width <px>` | 1400 | Viewport-breedte |
| `--height <px>` | 1000 | Viewport-hoogte |
| `--full` | false | Volledige paginahoogte i.p.v. viewport |
| `--wait <ms>` | 3500 | Wachttijd na laden (SSE houdt network actief) |
| `--report-overflow` | false | Print elementen die horizontaal overflown |

Voorbeelden:

```
node scripts/screenshot.mjs /sessions --layout list --out screenshots/sessions-list.png
node scripts/screenshot.mjs /sessions --layout split --report-overflow
```
