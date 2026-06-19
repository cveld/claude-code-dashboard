import { test, expect } from "@playwright/test";

test.describe("Sessions layout toggle", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start from list mode each time
    await page.goto("http://localhost:3000/sessions");
    await page.evaluate(() => localStorage.removeItem("sessions-layout"));
    await page.reload();
    // Wait for the toggle buttons to appear — SSE keeps network active so networkidle never fires
    await page.waitForSelector('button[title="List view"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  test("layout toggle buttons are present in list mode", async ({ page }) => {
    const listBtn = page.locator('button[title="List view"]');
    const splitBtn = page.locator('button[title="Split view"]');
    await expect(listBtn).toBeVisible();
    await expect(splitBtn).toBeVisible();
    // List button should be active
    await expect(listBtn).toHaveClass(/bg-zinc-700/);
  });

  test("tail expand buttons present in list mode", async ({ page }) => {
    const tailBtns = page.locator('button[title="Preview tail"]');
    await expect(tailBtns.first()).toBeVisible();
  });

  test("switch to split mode shows left panel and placeholder", async ({ page }) => {
    await page.locator('button[title="Split view"]').click();
    await page.waitForTimeout(400);

    // URL stays at /sessions (no slug/id yet)
    expect(page.url()).toMatch(/\/sessions(\?.*)?$/);
    expect(page.url()).not.toContain("slug=");

    // Left panel exists
    await expect(page.locator(".w-72")).toBeVisible();

    // Placeholder shown on right
    await expect(page.locator("text=Select a session to view the transcript")).toBeVisible();

    // Tail expand buttons are NOT shown in split mode
    const tailBtns = page.locator('button[title="Preview tail"]');
    await expect(tailBtns).toHaveCount(0);
  });

  test("selecting a session in split mode loads transcript and updates URL", async ({ page }) => {
    await page.locator('button[title="Split view"]').click();
    await page.waitForTimeout(400);

    // Session row buttons have text-left; group-header toggle buttons do not
    const firstSession = page.locator(".w-72 button.text-left").first();
    await expect(firstSession).toBeVisible();
    await firstSession.click();
    await page.waitForTimeout(2000);

    // URL should have slug and id params
    const url = page.url();
    expect(url).toContain("slug=");
    expect(url).toContain("id=");

    // Placeholder is gone
    await expect(page.locator("text=Select a session to view the transcript")).not.toBeVisible();

    // Right panel has mark read/unread button (exact match to avoid false positives from session titles)
    const markBtn = page.locator("button").filter({ hasText: /^Mark as (read|unread)$/ });
    await expect(markBtn).toBeVisible();
  });

  test("switching back to list mode restores tail expand buttons", async ({ page }) => {
    // Go to split mode and select a session
    await page.locator('button[title="Split view"]').click();
    await page.waitForTimeout(400);

    // Switch back to list
    await page.locator('button[title="List view"]').click();
    await page.waitForTimeout(400);

    // List mode active
    await expect(page.locator('button[title="List view"]')).toHaveClass(/bg-zinc-700/);

    // Tail expand buttons are back
    const tailBtns = page.locator('button[title="Preview tail"]');
    await expect(tailBtns.first()).toBeVisible();
  });

  test("layout preference persists across reload", async ({ page }) => {
    // Switch to split
    await page.locator('button[title="Split view"]').click();
    await page.waitForTimeout(200);

    // Reload (SSE keeps network active, so wait for element instead of networkidle)
    await page.reload();
    await page.waitForSelector('button[title="Split view"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Should still be in split mode
    await expect(page.locator(".w-72")).toBeVisible();
    await expect(page.locator('button[title="Split view"]')).toHaveClass(/bg-zinc-700/);
  });
});
