/**
 * @file Boot guard: the tools page boots, the game frame connects, and every workspace shows with
 * zero errors on the tools page, in the game frame and on the network (the `errors` fixture fails
 * the test on any). A deep link by hash opens its workspace directly.
 */
import { expect, openTools, test, WORKSPACES } from "./fixtures";

test.describe("no js errors", () => {
  for (const { id, label } of WORKSPACES) {
    test(`${label} workspace shows with zero errors`, async ({ tools, errors }) => {
      await tools.show(id);
      await expect(tools.host(id)).toHaveAttribute("aria-label", label);
      await expect(tools.host(id).locator("[data-panel]").first()).toBeVisible();
      // Let the view stream a few heartbeats and snapshots.
      await tools.page.waitForTimeout(1500);
      expect(errors.unexpected()).toEqual([]);
    });
  }

  for (const { id, label } of WORKSPACES) {
    test(`deep link #${id} opens ${label} with zero errors`, async ({ page, errors }) => {
      await openTools(page, `#${id}`);
      await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", id);
      await expect(page.locator(`[data-workspace-host=${id}]`)).toBeVisible();
      await page.waitForTimeout(1000);
      expect(errors.unexpected()).toEqual([]);
    });
  }
});
