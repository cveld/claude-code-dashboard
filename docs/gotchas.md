# Gotchas

## body is blokcontainer — page containers hebben `w-full` nodig

`app/layout.tsx` geeft de body **geen** `flex flex-col` meer (dit is verwijderd). In een block-context zorgt `mx-auto` op een child ervoor dat die child **krimpt naar content-breedte** i.p.v. te stretchen. Dit is onzichtbaar zolang er brede content (lange sessietitels) aanwezig is, maar breekt bij dunne content.

**Fix:** altijd `w-full` toevoegen aan de top-level page container:

```tsx
<div className="max-w-5xl w-full mx-auto px-4 py-8">
```

## Tailwind 4 — willekeurige grid-template-columns werken niet betrouwbaar

`grid-cols-[auto_1fr_auto]` genereert de CSS-class mogelijk niet in Tailwind 4 (CSS-first aanpak). Gebruik in plaats daarvan inline `style`:

```tsx
<div
  className="items-center gap-2"
  style={{ display: "grid", gridTemplateColumns: "auto 1fr auto" }}
>
```

Dit bypass Tailwind class-generatie volledig en werkt gegarandeerd.

## Mobile: adresbalk + sticky header vereisen natural body scroll

Op mobile verbergt de browser de adresbalk alleen bij **window/body scroll** — niet bij een interne scroller. `position: sticky` werkt alleen correct als de **viewport** de scroll container is.

**Oud (kapot) patroon — gebruik dit niet meer voor lijstpagina's:**
```tsx
<div className="h-screen flex flex-col overflow-hidden w-full">
  <div className="shrink-0">header</div>
  <div className="flex-1 overflow-y-auto">content</div>
</div>
```

**Correct patroon voor lijstpagina's:**
```tsx
<div className="w-full">
  <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800">header</div>
  <div>content</div>
</div>
```

Vereisten in `layout.tsx`:
- `<html>`: geen `h-full`, geen `flex`
- `<body>`: `min-h-screen` (geen `flex flex-col`, geen overflow)
- `globals.css`: `html, body { overflow-x: clip; }` (zie sectie hieronder)

**Uitzondering:** de split-view in `/sessions` heeft `h-screen flex flex-col overflow-hidden` nodig voor de twee onafhankelijk scrollende kolommen. Daar verbergt de adresbalk zich niet automatisch — dat is bewust.

## `overflow-x: clip` i.p.v. `overflow-x: hidden`

`overflow-x: hidden` maakt van het element een **scroll container** (de browser zet `overflow-y` impliciet op `auto`). Dit breekt `position: sticky` en `position: fixed`.

`overflow-x: clip` knipt dezelfde content af **zonder** een scroll container te maken — viewport blijft de scroll container.

Zonder enige overflow-x op html/body expandeert horizontale overflow de **mobile layout viewport**. Dan positioneert `position: fixed` zich relatief aan de layout viewport (bv. 1024px breed) i.p.v. aan de visual viewport (375px), waardoor fixed/sticky elementen buiten beeld verdwijnen.

**Correct in `globals.css`:**
```css
html, body {
  overflow-x: clip;
}
```

## Interne scrollbars vereisen een bounded hoogte — alleen voor split-view

De split-view in `/sessions` gebruikt `h-screen flex flex-col overflow-hidden`. `min-height` geeft géén *definite* hoogte, dus een child met `flex-1 overflow-hidden` krijgt geen bounded hoogte zonder `h-screen` op de root.

**Fix voor split-view root:** `h-screen` i.p.v. `flex-1`. De geneste `overflow-y-auto` containers werken dan wél. Zie `screens.md` → Split-modus.

Dit geldt **niet** voor lijstpagina's — die gebruiken natural body scroll (zie sectie hierboven).

## HMR verificatie op mobile

HMR via WebSocket werkt niet altijd wanneer een telefoon de dev server benadert via het lokale netwerk. De `ScreenDimensions` component (`app/components/ScreenDimensions.tsx`) toont rechtsonder een tijdstempel (`HMR_STAMP`) die op module-niveau wordt geëvalueerd — dus ververst bij elke HMR update.

Als de tijdstempel niet verandert bij code-aanpassingen: de gebruiker heeft oude code. Handmatig herladen van de pagina op de telefoon is dan nodig.

Indicator staat op `bottom-2 right-2` (niet top) om te voorkomen dat de adresbalk hem bedekt.
