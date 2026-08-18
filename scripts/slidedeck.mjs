// Capture screenshots of dashboard pages at multiple widths and generate
// a self-contained navigable HTML slide deck.
//
//   node scripts/slidedeck.mjs [options]
//
// Options:
//   --out <file>    Output HTML path (default: screenshots/slidedeck.html)
//   --base <url>    Base URL (default: http://localhost:3000)
//   --wait <ms>     Settle time per screenshot (default: 3500)
//   --height <px>   Viewport height (default: 900)
//
// The dev server must be running (npm run dev).
//
// Keyboard navigation in the generated HTML:
//   ← →   cycle widths within a page
//   ↑ ↓   cycle between page types

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// ── Facets ──────────────────────────────────────────────────────────────────
// Define which pages to capture and at which widths.
// layout: 'list' | 'split' | null  — pre-seeds localStorage "sessions-layout"

const FACETS = [
  { page: "Sessions (list)",  route: "/sessions", layout: "list",  widths: [375, 768, 1024, 1400] },
  { page: "Sessions (split)", route: "/sessions", layout: "split", widths: [1024, 1400] },
  { page: "Settings",         route: "/settings", layout: null,    widths: [375, 768, 1024, 1400] },
  { page: "Gallery",          route: "/gallery",  layout: null,    widths: [1024, 1400] },
];

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { out: "screenshots/slidedeck.html", base: "http://localhost:3000", wait: 3500, height: 900 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--out":    opts.out    = argv[++i]; break;
      case "--base":   opts.base   = argv[++i]; break;
      case "--wait":   opts.wait   = Number(argv[++i]); break;
      case "--height": opts.height = Number(argv[++i]); break;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const base = opts.base.replace(/\/$/, "");

// ── Capture ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const groups = [];

for (const facet of FACETS) {
  const slides = [];
  for (const width of facet.widths) {
    const page = await browser.newPage({ viewport: { width, height: opts.height } });

    if (facet.layout) {
      await page.addInitScript((layout) => {
        localStorage.setItem("sessions-layout", layout);
      }, facet.layout);
    }

    const url = base + facet.route;
    process.stdout.write(`  ${facet.page} @ ${width}px ... `);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(opts.wait);

    const buf = await page.screenshot({ type: "jpeg", quality: 82 });
    await page.close();

    slides.push({ width, data: buf.toString("base64") });
    console.log("done");
  }
  groups.push({ page: facet.page, slides });
}

await browser.close();

const totalSlides = groups.reduce((s, g) => s + g.slides.length, 0);
console.log(`\nCaptured ${groups.length} pages, ${totalSlides} slides total.`);

// ── Generate HTML ─────────────────────────────────────────────────────────────
const html = buildHtml(groups);
await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
await writeFile(opts.out, html, "utf8");
console.log(`Saved ${opts.out}`);

function buildHtml(groups) {
  const payload = JSON.stringify(
    groups.map((g) => ({
      page: g.page,
      slides: g.slides.map((s) => ({ width: s.width, src: `data:image/jpeg;base64,${s.data}` })),
    }))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dashboard Slide Deck</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#a1a1aa;font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}

#topbar{display:flex;align-items:center;gap:16px;padding:10px 16px;border-bottom:1px solid #27272a;background:#18181b;flex-shrink:0}
#topbar h1{font-size:13px;font-weight:600;color:#e4e4e7}
#counter{font-size:11px;color:#52525b;margin-left:auto}
#shortcuts{font-size:11px;color:#3f3f46}

#layout{display:flex;flex:1;overflow:hidden}

#sidebar{width:210px;flex-shrink:0;border-right:1px solid #27272a;overflow-y:auto;padding:8px 0}
.group-label{padding:6px 12px 3px;font-size:12px;cursor:pointer;border-left:2px solid transparent;color:#71717a;line-height:1.4}
.group-label:hover{color:#d4d4d8}
.group-label.active{border-left-color:#3b82f6;color:#e4e4e7;background:#1e3a5f22}
.group-widths{display:flex;flex-wrap:wrap;gap:4px;padding:3px 12px 10px 14px}
.group-widths button{font-size:10px;font-family:monospace;padding:2px 7px;border:1px solid #3f3f46;border-radius:3px;background:none;color:#52525b;cursor:pointer}
.group-widths button:hover{color:#a1a1aa;border-color:#52525b}
.group-widths button.active{border-color:#3b82f6;color:#93c5fd;background:#1e3a5f44}

#main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#viewer{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px;background:#09090b}
#viewer img{max-width:100%;display:block;border-radius:6px;border:1px solid #27272a;box-shadow:0 4px 24px rgba(0,0,0,.6)}

#navbar{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;border-top:1px solid #27272a;background:#18181b;flex-shrink:0}
.nav-btn{background:#27272a;border:1px solid #3f3f46;color:#a1a1aa;font-size:14px;width:32px;height:32px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.nav-btn:hover{background:#3f3f46;color:#e4e4e7}
.nav-btn:disabled{opacity:.3;cursor:default;pointer-events:none}
#slide-info{font-size:12px;text-align:center;min-width:180px;color:#71717a;line-height:1.6}
#slide-info strong{color:#d4d4d8;display:block}
#width-badge{font-size:10px;font-family:monospace;background:#27272a;padding:2px 7px;border-radius:4px;color:#52525b}
</style>
</head>
<body>
<div id="topbar">
  <h1>Dashboard Slide Deck</h1>
  <span id="counter"></span>
  <span id="shortcuts">← → width &nbsp;·&nbsp; ↑ ↓ page</span>
</div>
<div id="layout">
  <nav id="sidebar"></nav>
  <div id="main">
    <div id="viewer"><img id="img" alt="" /></div>
    <div id="navbar">
      <button class="nav-btn" id="btn-up" title="Previous page (↑)">↑</button>
      <button class="nav-btn" id="btn-prev" title="Previous width (←)">←</button>
      <div id="slide-info">
        <strong id="page-name"></strong>
        <span id="width-badge"></span>
      </div>
      <button class="nav-btn" id="btn-next" title="Next width (→)">→</button>
      <button class="nav-btn" id="btn-down" title="Next page (↓)">↓</button>
    </div>
  </div>
</div>
<script>
const GROUPS = ${payload};

let gi = 0, si = 0;

function render() {
  const g = GROUPS[gi], s = g.slides[si];
  document.getElementById('img').src = s.src;
  document.getElementById('page-name').textContent = g.page;
  document.getElementById('width-badge').textContent = s.width + 'px';
  document.getElementById('counter').textContent =
    'Page ' + (gi+1) + '/' + GROUPS.length + ' · Width ' + (si+1) + '/' + g.slides.length;
  document.getElementById('btn-up').disabled   = gi === 0;
  document.getElementById('btn-down').disabled = gi === GROUPS.length - 1;
  document.getElementById('btn-prev').disabled = si === 0;
  document.getElementById('btn-next').disabled = si === g.slides.length - 1;
  document.querySelectorAll('.group-label').forEach((el, i) => el.classList.toggle('active', i === gi));
  document.querySelectorAll('.width-btn').forEach(el =>
    el.classList.toggle('active', +el.dataset.gi === gi && +el.dataset.si === si)
  );
}

function goGroup(i) { if (i >= 0 && i < GROUPS.length) { gi = i; si = 0; render(); } }
function goSlide(i) { const n = GROUPS[gi].slides.length; if (i >= 0 && i < n) { si = i; render(); } }

// Build sidebar
const sidebar = document.getElementById('sidebar');
GROUPS.forEach((g, i) => {
  const label = document.createElement('div');
  label.className = 'group-label';
  label.textContent = g.page;
  label.addEventListener('click', () => goGroup(i));
  sidebar.appendChild(label);

  const row = document.createElement('div');
  row.className = 'group-widths';
  g.slides.forEach((s, j) => {
    const btn = document.createElement('button');
    btn.className = 'width-btn';
    btn.textContent = s.width + 'px';
    btn.dataset.gi = i;
    btn.dataset.si = j;
    btn.addEventListener('click', () => { gi = i; si = j; render(); });
    row.appendChild(btn);
  });
  sidebar.appendChild(row);
});

document.getElementById('btn-up').addEventListener('click',   () => goGroup(gi - 1));
document.getElementById('btn-down').addEventListener('click', () => goGroup(gi + 1));
document.getElementById('btn-prev').addEventListener('click', () => goSlide(si - 1));
document.getElementById('btn-next').addEventListener('click', () => goSlide(si + 1));

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goSlide(si - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goSlide(si + 1); }
  if (e.key === 'ArrowUp')    { e.preventDefault(); goGroup(gi - 1); }
  if (e.key === 'ArrowDown')  { e.preventDefault(); goGroup(gi + 1); }
});

render();
</script>
</body>
</html>`;
}
