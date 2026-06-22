import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Visual review harness for the transcript panel width logic. Renders a session
// that contains a wide markdown table at a range of viewport widths, captures a
// screenshot of each, measures horizontal overflow, and emits a self-contained
// HTML report at screenshots/transcript-width/index.html for manual review.
//
// Run:  npx playwright test transcript-width-report
// Then open: screenshots/transcript-width/index.html

const BASE = "http://localhost:3000";
const OUT_DIR = path.resolve("screenshots/transcript-width");
const WIDTHS = [480, 640, 768, 1024, 1280, 1600, 1920];

async function transcriptOverflow(page: Page) {
  return page.evaluate(() => {
    const scroller = [...document.querySelectorAll<HTMLElement>(".overflow-y-auto")].find(
      (el) => !el.closest(".w-72")
    );
    if (!scroller) return null;
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
  });
}

async function findSessionWithWideTable(page: Page) {
  const list = await page.request.get(`${BASE}/api/sessions?limit=80`);
  const sessions = (await list.json()) as { id: string; projectSlug: string; title?: string }[];
  for (const s of sessions.slice(0, 60)) {
    const r = await page.request.get(`${BASE}/api/projects/${s.projectSlug}/sessions/${s.id}`);
    const { messages } = (await r.json()) as { messages?: { text: string }[] };
    const hasWideTable = (messages ?? []).some((m) =>
      (m.text ?? "").split("\n").some((line) => {
        if (!/^\s*\|.*\|.*\|/.test(line)) return false;
        return ((line.match(/\|/g) ?? []).length - 1) >= 4;
      })
    );
    if (hasWideTable) return s;
  }
  return null;
}

test("transcript width review report across viewport widths", async ({ page }) => {
  test.slow(); // several reloads + screenshots

  const target = await findSessionWithWideTable(page);
  test.skip(target === null, "No session with a wide table found in the local data");

  await mkdir(OUT_DIR, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("sessions-layout", "split"));

  const url = `${BASE}/sessions?slug=${encodeURIComponent(
    target!.projectSlug
  )}&id=${encodeURIComponent(target!.id)}`;

  const results: { width: number; file: string; scrollWidth: number; clientWidth: number; ok: boolean }[] = [];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".overflow-y-auto table", { timeout: 15000 });
    // Scroll a table into view so the screenshot shows the interesting part.
    await page.evaluate(() => document.querySelector(".overflow-y-auto table")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(700);

    const overflow = await transcriptOverflow(page);
    const file = `w${width}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });

    const ok = overflow !== null && overflow.scrollWidth <= overflow.clientWidth + 1;
    results.push({
      width,
      file,
      scrollWidth: overflow?.scrollWidth ?? -1,
      clientWidth: overflow?.clientWidth ?? -1,
      ok,
    });
  }

  // Build the HTML report.
  const rows = results
    .map(
      (r) => `
      <section class="card ${r.ok ? "ok" : "bad"}">
        <header>
          <span class="w">${r.width}px viewport</span>
          <span class="badge">${r.ok ? "no column overflow" : "OVERFLOW"}</span>
          <span class="meas">transcript scrollWidth ${r.scrollWidth} / clientWidth ${r.clientWidth}</span>
        </header>
        <a href="./${r.file}" target="_blank"><img src="./${r.file}" alt="transcript at ${r.width}px" /></a>
      </section>`
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Transcript width review</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #18181b; color: #e4e4e7; }
  .head { padding: 24px; border-bottom: 1px solid #27272a; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .sub { color: #a1a1aa; font-size: 13px; }
  .grid { display: flex; flex-direction: column; gap: 24px; padding: 24px; }
  .card { border: 1px solid #27272a; border-radius: 10px; overflow: hidden; background: #09090b; }
  .card header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #27272a; }
  .card .w { font-weight: 600; }
  .card .meas { margin-left: auto; color: #71717a; font-family: ui-monospace, monospace; font-size: 12px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: .05em; }
  .ok .badge { background: #052e16; color: #4ade80; }
  .bad .badge { background: #450a0a; color: #f87171; }
  .ok { border-color: #14532d55; }
  .bad { border-color: #7f1d1d; }
  img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
  <div class="head">
    <h1>Transcript panel width review</h1>
    <div class="sub">Session: ${target!.title ?? target!.id} &middot; ${target!.projectSlug}<br/>
    Each card shows the split-view transcript at a different viewport width. "No column overflow" means the transcript scroll container is not wider than its client area (wide tables scroll within their own wrapper instead).</div>
  </div>
  <div class="grid">
    ${rows}
  </div>
</body>
</html>`;

  await writeFile(path.join(OUT_DIR, "index.html"), html, "utf-8");
  console.log(`\nReport written: ${path.join(OUT_DIR, "index.html")}\n`);

  // The whole point of the fix: no width should overflow the transcript column.
  for (const r of results) {
    expect(r.scrollWidth, `viewport ${r.width}px overflows`).toBeLessThanOrEqual(r.clientWidth + 1);
  }
});
