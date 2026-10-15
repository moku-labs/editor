/**
 * @file The Render workspace reads the browser's frames: the tiny game's page carries the agent
 * flag a `moku-game dev` page carries, so the engine's monitor fills its ring, the editor's perf
 * measures it and the strip shows a live session with the facts of the real engine's header
 * (backend, the screen). A strip that stays `waiting` (no frame ever read) or refuses perf's values
 * shows "0 / 0 fps" and dashes: the "Render shows nonsense" report.
 */
import { expect, test } from "./fixtures";

test.describe("render", () => {
  test("the strip is live on the browser session: the backend and the screen come from the engine's header", async ({
    tools
  }) => {
    await tools.show("render");
    const strip = tools.page.locator("[data-render=device-strip]");
    await expect(strip).toHaveAttribute("data-perf", "live");
    await expect(strip.locator("[data-cell=backend] [data-part=value]")).toHaveText("webgl");
    await expect(strip.locator("[data-part=about]")).toContainText(" Hz, dpr ");
  });
});
