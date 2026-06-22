// Capture a screenshot of a running dashboard page — handy for eyeballing UI
// changes without leaving the terminal.
//
//   node scripts/screenshot.mjs <route-or-url> [options]
//
// Options:
//   --out <file>        Output PNG path (default: screenshots/shot.png)
//   --layout <mode>     Pre-seed localStorage "sessions-layout" (list | split)
//   --width <px>        Viewport width  (default 1400)
//   --height <px>       Viewport height (default 1000)
//   --base <url>        Base URL for bare routes (default http://localhost:3000)
//   --full              Capture the full scrollable page, not just the viewport
//   --wait <ms>         Settle time after load (default 3500)
//   --report-overflow   Print elements whose content overflows horizontally
//
// The dev server (`npm run dev`) must already be running. We wait on
// DOMContentLoaded rather than networkidle because the SSE stream on
// /api/events keeps the network perpetually busy.
//
// Examples:
//   node scripts/screenshot.mjs /sessions --layout split --out screenshots/split.png
//   node scripts/screenshot.mjs "/sessions?slug=foo&id=bar" --layout split --report-overflow

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const opts = {
    out: "screenshots/shot.png",
    layout: null,
    width: 1400,
    height: 1000,
    base: "http://localhost:3000",
    full: false,
    wait: 3500,
    reportOverflow: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--out": opts.out = argv[++i]; break;
      case "--layout": opts.layout = argv[++i]; break;
      case "--width": opts.width = Number(argv[++i]); break;
      case "--height": opts.height = Number(argv[++i]); break;
      case "--base": opts.base = argv[++i]; break;
      case "--wait": opts.wait = Number(argv[++i]); break;
      case "--full": opts.full = true; break;
      case "--report-overflow": opts.reportOverflow = true; break;
      default: positional.push(a);
    }
  }
  opts.target = positional[0];
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target) {
  console.error("Usage: node scripts/screenshot.mjs <route-or-url> [options]");
  process.exit(1);
}

const url = /^https?:\/\//.test(opts.target)
  ? opts.target
  : opts.base.replace(/\/$/, "") + (opts.target.startsWith("/") ? opts.target : "/" + opts.target);

await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });

if (opts.layout) {
  await page.addInitScript((layout) => {
    localStorage.setItem("sessions-layout", layout);
  }, opts.layout);
}

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(opts.wait);

if (opts.reportOverflow) {
  const overflowers = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() ?? "").slice(0, 70),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
      }))
      .slice(0, 20)
  );
  console.log("Horizontal overflow elements:", JSON.stringify(overflowers, null, 2));
}

await page.screenshot({ path: opts.out, fullPage: opts.full });
await browser.close();
console.log(`Saved ${opts.out}  ←  ${url}`);
