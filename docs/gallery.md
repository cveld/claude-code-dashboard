# Gallery & Responsive Viewer

Dev-only tooling onder `/gallery`. Retourneert 404 in production.

## Routes

| Route | Doel |
|---|---|
| `/gallery` | Wikkelt alleen `ResponsiveViewer` |
| `/gallery/components` | Standalone fixture-pagina met status indicators + session tiles — geen nav, geschikt als iframe-target |

## ResponsiveViewer (`app/gallery/responsive-viewer.tsx`)

Toont een van de app-pagina's in een gesimuleerde viewport via een geschaalde `<iframe>`.

### PAGES

```ts
{ label: 'Projects',    url: '/' }
{ label: 'Sessions',    url: '/sessions' }
{ label: 'Settings',    url: '/settings' }
{ label: 'Components',  url: '/gallery/components' }
```

### DEVICE_PRESETS (phone-rij)

Snelknoppen boven de breedte-rij. Eén klik stelt width + clip-hoogte in én zet de chrome bar aan.

| Label | Width | Height |
|---|---|---|
| portrait | 360px | 639px |
| landscape | 695px | 274px |

Actief preset wordt groen gemarkeerd. Klikken op een generieke WIDTHS-knop wist `activeDevice`.

### WIDTHS & schaallogica

`WIDTHS = [375, 768, 1024, 1400]`

- `viewerW = Math.min(containerW, width)` — nooit upscalen boven 1:1
- `scale = viewerW / width`
- `containerW` gemeten via `ResizeObserver` op een `w-full` wrapper-div

### CLIP_PRESETS (hoogte-afkapping, generieke breedtes)

| Breedte | Label | Hoogte |
|---|---|---|
| 375px | portrait | 667px (iPhone SE) |
| 768px | landscape | 432px (16:9) |

Als clip actief: `iframe height = preset.height` (niet de standaard 1200px) → pagina scrollt intern als op echt device. Zonder clip: `iframe height = 1200px`.

Toggle verschijnt alleen als het geselecteerde width een generiek preset heeft én geen device-preset actief is.

### ChromeBar & scroll-away

`CHROME_BAR_H = 56px`. Fake Chrome Android adresbalk: donkere bg (`#202124`), adrespil met lock-icoon + `localhost:3000<path>`, tab-teller, kebab-menu.

### CSS-injectie in het iframe

Na elke `frameKey`-wissel injecteert `ResponsiveViewer` een `<style id="gallery-scrollbar-override">` in het iframe-document. Twee doelen:

| CSS | Reden |
|---|---|
| `::-webkit-scrollbar { width: 3px }` + `scrollbar-width: thin` | Simuleert Android Chrome overlay-scrollbars (~3px, geen layout-impact) |
| `.group-hover\:opacity-100 { opacity: 1 !important }` | Simuleert touch: maakt alle `opacity-0 group-hover:opacity-100` knoppen altijd zichtbaar |

Implementatie: `useEffect` met `[frameKey]` dependency, attach op `load`-event van de iframe, guard op `getElementById('gallery-scrollbar-override')` om dubbele injectie te voorkomen.

Bar scrollt weg via scroll-listener op het same-origin iframe:
- `barScrollOffset = min(iframe.contentWindow.scrollY, CHROME_BAR_H)` — passive scroll listener, opnieuw gekoppeld bij elke `frameKey`-wissel
- Inner wrapper krijgt `translateY(-barScrollOffset)` → bar schuift achter de `overflow:hidden` clip edge

Hoogte-model — `renderedH` = content viewport hoogte (`window.innerHeight` met bar zichtbaar):
- `iframeFullH = renderedH + CHROME_BAR_H` — **constant**, iframe krijgt altijd deze hoogte, geen resize mid-scroll
- `barOffset = barScrollOffset` (0 → 56) → inner wrapper schuift omhoog
- `containerH = iframeFullH * scale` — constant
- Netto effect: bar verdwijnt boven, extra iframe-hoogte vult onder in → viewport groeit van `renderedH` naar `renderedH + CHROME_BAR_H`

### Toggles (controls-rij)

| Toggle | State | Effect |
|---|---|---|
| `{preset.label} ×{h}px` | `clipActive` | Kapt hoogte af, iframe rendert op device-height |
| `chrome bar` | `showAddressBar` | Toont `ChromeBar` boven iframe (scrollt weg bij scrollen in iframe) |
| `dimensions` | `showDimensions` | Badge bottom-right van viewer: `width × renderedH` |

### Dimensions-badge positie

Badge staat **buiten** de `overflow-hidden` container, in een `relative` wrapper van exact `viewerW` breed. Zo wordt hij nooit weggeknipt.

## ScreenDimensions (`app/components/ScreenDimensions.tsx`)

Fixed overlay (`top-2 right-2 z-50`) met live `window.innerWidth × window.innerHeight`. Luistert op `resize`. Alleen gerenderd als `NODE_ENV === 'development'` (in `app/layout.tsx`). Handig in combinatie met de responsive viewer om de daadwerkelijke iframe-afmetingen te controleren.
