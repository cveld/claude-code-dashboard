import { test, expect, type Page } from "@playwright/test";

// Regression test for the transcript panel width issue: wide content (especially
// markdown tables) used to stretch the transcript column, producing a
// column-wide horizontal scrollbar. The fix gives the message bubble `min-w-0`
// and wraps every table in an `overflow-x-auto` container so wide tables scroll
// within the bubble instead. See app/components/TranscriptPanel.tsx.

const BASE = "http://localhost:3000";

// Measure horizontal overflow of the transcript scroll container (the
// `overflow-y-auto` element that is NOT the left session list in `.w-72`).
async function transcriptOverflow(page: Page) {
  return page.evaluate(() => {
    const scroller = [...document.querySelectorAll<HTMLElement>(".overflow-y-auto")].find(
      (el) => !el.closest(".w-72")
    );
    if (!scroller) return null;
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
  });
}

async function enterSplitMode(page: Page) {
  await page.goto(`${BASE}/sessions`);
  await page.evaluate(() => localStorage.setItem("sessions-layout", "split"));
  await page.reload();
  // SSE keeps the network busy, so wait on an element rather than networkidle.
  await page.waitForSelector('button[title="Split view"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

test.describe("Transcript panel width", () => {
  test("transcript column does not overflow horizontally", async ({ page }) => {
    await enterSplitMode(page);

    const firstSession = page.locator(".w-72 button.text-left").first();
    await expect(firstSession).toBeVisible();
    await firstSession.click();

    // Wait for the transcript to render its scroll container.
    await page.waitForFunction(
      () =>
        !![...document.querySelectorAll<HTMLElement>(".overflow-y-auto")].find(
          (el) => !el.closest(".w-72")
        ),
      undefined,
      { timeout: 15000 }
    );
    await page.waitForTimeout(800);

    const overflow = await transcriptOverflow(page);
    expect(overflow).not.toBeNull();
    // Allow a 1px rounding tolerance; anything more is a real horizontal scrollbar.
    expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth + 1);
  });

  test("a session with a wide table keeps the table inside a scrollable wrapper", async ({ page }) => {
    // Find a session whose transcript contains a markdown table with >= 4 columns.
    const list = await page.request.get(`${BASE}/api/sessions?limit=80`);
    const sessions = (await list.json()) as { id: string; projectSlug: string }[];

    let target: { id: string; projectSlug: string } | null = null;
    for (const s of sessions.slice(0, 60)) {
      const r = await page.request.get(
        `${BASE}/api/projects/${s.projectSlug}/sessions/${s.id}`
      );
      const { messages } = (await r.json()) as { messages?: { text: string }[] };
      const hasWideTable = (messages ?? []).some((m) =>
        (m.text ?? "").split("\n").some((line) => {
          if (!/^\s*\|.*\|.*\|/.test(line)) return false;
          return ((line.match(/\|/g) ?? []).length - 1) >= 4;
        })
      );
      if (hasWideTable) {
        target = { id: s.id, projectSlug: s.projectSlug };
        break;
      }
    }

    test.skip(target === null, "No session with a wide table found in the local data");

    await page.addInitScript(() => localStorage.setItem("sessions-layout", "split"));
    await page.goto(
      `${BASE}/sessions?slug=${encodeURIComponent(target!.projectSlug)}&id=${encodeURIComponent(target!.id)}`
    );

    // Wait for at least one rendered table in the transcript.
    await page.waitForSelector(".overflow-y-auto table", { timeout: 15000 });
    await page.waitForTimeout(800);

    // 1) The transcript column itself must not overflow horizontally.
    const overflow = await transcriptOverflow(page);
    expect(overflow).not.toBeNull();
    expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth + 1);

    // 2) Every rendered table sits in an overflow-x-auto wrapper bounded by the column.
    const tableCheck = await page.evaluate(() => {
      const tables = [...document.querySelectorAll<HTMLElement>(".overflow-y-auto table")];
      return tables.map((tbl) => {
        const wrap = tbl.parentElement as HTMLElement;
        return {
          wrapHasScrollClass: wrap.className.includes("overflow-x-auto"),
          wrapWithinViewport: wrap.clientWidth <= window.innerWidth,
          // If the table is wider than its wrapper, the wrapper must be the one
          // that scrolls — never the transcript column.
          wrapScrollsWhenWide:
            tbl.scrollWidth <= wrap.clientWidth + 1 || wrap.scrollWidth > wrap.clientWidth,
        };
      });
    });

    expect(tableCheck.length).toBeGreaterThan(0);
    for (const t of tableCheck) {
      expect(t.wrapHasScrollClass).toBe(true);
      expect(t.wrapWithinViewport).toBe(true);
      expect(t.wrapScrollsWhenWide).toBe(true);
    }
  });
});
