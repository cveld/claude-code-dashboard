# Gallery route for UI state validation

**Status:** Open  
**Created:** 2026-06-25

## Goal

A `/gallery` route inside the existing Next.js app that renders all session tile variants with hardcoded fixture data. Intended for visual validation after styling changes, and as a basis for Playwright screenshots.

## Decisions

- **No separate app**, no Storybook — dev-only route in the same Next.js app
- Accessible via the Settings menu
- Gated on `NODE_ENV !== "production"` (route returns 404 in production)

## States to show

Each state gets its own tile, grouped with a label:

| Label | Description |
|---|---|
| Unread | Blue dot, no hook |
| Read | No dot, no hook |
| Unread + completed | Green check (`HookBadge` stop + unread) |
| Read + completed | Grey check (`HookBadge` stop + read) |
| Notification | Amber bell (`HookBadge` notification) |
| Monitor active | Green dot on Send button |
| Context low (30%) | Blue context bar |
| Context high (80%) | Orange context bar |
| Context critical (95%) | Red context bar |
| Long title | Truncation visible |

## Implementation approach

`app/gallery/page.tsx` — client component, `"use client"`.

1. Copy relevant helper functions from `sessions/page.tsx`:
   - `HookBadge`, `IconCheck`, `IconBell`
   - `contextBarColor`
2. Define fixture data inline (no fetch, no API):
   ```ts
   const FIXTURES: TileFixture[] = [
     { label: "Unread", unread: true, hook: null, ctxPct: null, monitorActive: false },
     { label: "Read", unread: false, hook: null, ctxPct: null, monitorActive: false },
     // ...
   ]
   ```
3. Render a simplified tile per fixture — same Tailwind classes as the real tile in `sessions/page.tsx`, but without interactive state (no `markSession`, no `toggleTail`).
4. Group into sections: "Status indicators", "Session tiles".

## Settings menu link

In `app/settings/page.tsx`: add a "Developer" section at the bottom with a link to `/gallery`. Always show it — the route itself already returns 404 in production.

## Playwright usage

After implementation:
```
node scripts/screenshot.mjs /gallery --out screenshots/gallery.png --wait 1000
```

No API mocking needed — the page has no external data dependencies.

## Related files

- `app/sessions/page.tsx` — source of tile JSX and helpers
- `app/settings/page.tsx` — Settings menu where the link goes
- `scripts/screenshot.mjs` — screenshot tool
- `docs/testing.md` — testing structure overview
