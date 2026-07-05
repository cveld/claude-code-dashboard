import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

const HOOK_STORE_PATH = path.join(os.homedir(), ".claude", "dashboard-hook-events.json");

interface SessionWithProject {
  id: string;
  projectSlug: string;
  title: string | null;
  firstUserMessage: string | null;
}

test.describe("Permission-request highlight", () => {
  let hookStoreSnapshot: string | null = null;

  test.beforeEach(() => {
    // Snapshot the hook-events store so the simulated event can be reverted —
    // this file is shared with the user's real dashboard.
    hookStoreSnapshot = fs.existsSync(HOOK_STORE_PATH) ? fs.readFileSync(HOOK_STORE_PATH, "utf-8") : null;
  });

  test.afterEach(() => {
    if (hookStoreSnapshot === null) {
      fs.rmSync(HOOK_STORE_PATH, { force: true });
    } else {
      fs.writeFileSync(HOOK_STORE_PATH, hookStoreSnapshot);
    }
  });

  test("a PermissionRequest hook event highlights the session on /sessions", async ({ page, request }) => {
    const sessions: SessionWithProject[] = await request.get("http://localhost:3000/api/sessions").then((r) => r.json());
    test.skip(sessions.length === 0, "no local sessions available to target");
    const target = sessions[0];

    // Simulate the PermissionRequest hook POST (same shape as the PowerShell
    // snippet on /settings) before loading the page — /sessions seeds hookNotifs
    // from the persisted store on initial load, so no live-SSE timing is needed.
    await request.post("http://localhost:3000/api/hooks", {
      data: {
        event: "permission",
        sessionId: target.id,
        transcriptPath: `${target.projectSlug}/${target.id}.jsonl`,
        cwd: target.projectSlug,
        tool: "Bash",
      },
    });

    await page.goto("http://localhost:3000/sessions");
    await page.waitForTimeout(2000);

    const rowText = target.title ?? target.firstUserMessage ?? target.id;
    const row = page
      .locator(".rounded-lg", { hasText: rowText })
      .first();
    await row.scrollIntoViewIfNeeded();

    await expect(row).toHaveClass(/ring-red-500/);
    await expect(row.locator('[title*="Permission needed"]')).toBeVisible();
    await expect(row.locator('[title*="Bash"]')).toBeVisible();
  });
});
