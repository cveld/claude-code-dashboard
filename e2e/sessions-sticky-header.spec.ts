import { test, expect } from "@playwright/test";

test.describe("Sessions page sticky header (list mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/sessions");
    // Ensure list mode
    await page.evaluate(() => localStorage.removeItem("sessions-layout"));
    await page.reload();
    await page.waitForSelector('button[title="List view"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  test("header has position:sticky", async ({ page }) => {
    // The sticky wrapper contains the sort button — locate via that
    const sortBtn = page.locator("button", { hasText: /Newest first|Oldest first/ });
    await expect(sortBtn).toBeVisible();

    const stickyWrapper = page.locator("div.sticky");
    await expect(stickyWrapper).toBeVisible();

    const position = await stickyWrapper.evaluate(
      (el) => window.getComputedStyle(el).position
    );
    expect(position).toBe("sticky");
  });

  test("nav tabs remain visible after scrolling to bottom", async ({ page }) => {
    const sessionsTab = page.locator("nav a", { hasText: "Sessions" });
    await expect(sessionsTab).toBeVisible();

    // Scroll to the very bottom of the page
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(200);

    // The nav and controls should still be in the viewport
    await expect(sessionsTab).toBeInViewport();
    const sortBtn = page.locator("button", { hasText: /Newest first|Oldest first/ });
    await expect(sortBtn).toBeInViewport();
  });

  test("sticky header top offset is 0 after scrolling", async ({ page }) => {
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(200);

    const stickyWrapper = page.locator("div.sticky");
    const boundingBox = await stickyWrapper.boundingBox();
    expect(boundingBox).not.toBeNull();
    // After scrolling, the sticky element should be pinned at the top (y < 1px)
    expect(boundingBox!.y).toBeLessThan(1);
  });

  test("sticky header not present in split mode (has its own layout)", async ({ page }) => {
    await page.locator('button[title="Split view"]').click();
    await page.waitForTimeout(400);

    // In split mode there is no scrollable page — no div.sticky wrapper
    const stickyWrappers = page.locator("div.sticky");
    await expect(stickyWrappers).toHaveCount(0);
  });
});
