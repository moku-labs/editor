/**
 * @file Visual goldens: one full-page screenshot per workspace per viewport (the project name is
 * in the file name). The live regions (link pill, session chip, game canvas, frame counters, fps
 * tiles, the runner and session cards) are masked; animations are off and fonts are ready.
 */
import { expect, test, WORKSPACES } from "./fixtures";

test.describe("baseline", () => {
  for (const { id, label } of WORKSPACES) {
    test(`${label} workspace`, async ({ tools }) => {
      await tools.show(id);
      // Let the view settle on its first snapshot (Flow layout, Files index, Render bundles).
      await tools.page.waitForTimeout(1500);
      await tools.settle();
      await expect(tools.page).toHaveScreenshot(`${id}.png`, {
        fullPage: true,
        mask: tools.volatile()
      });
    });
  }
});
