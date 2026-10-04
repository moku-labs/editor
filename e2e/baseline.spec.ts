/**
 * @file Visual goldens: one full-page screenshot per workspace per viewport (the project name is
 * in the file name). The live regions (link pill, session chip, game canvas, frame counters, fps
 * tiles, the runner and session cards, the Last commit body and tags) are masked; animations are
 * off and fonts are ready. State shows one known commit, so the Last commit card always has the
 * same height: whether a boot commit lands after the tools page attached is timing. The goldens
 * show what a fresh viewer sees: the default device (the iPhone 18 Pro since round 2b R10), not
 * the iPhone 15 the other specs pin.
 */
import type { Frame, Page } from "@playwright/test";
import { expect, type Tools, test, WORKSPACES } from "./fixtures";

/** The session part of a game.bookmark value this spec changes. */
type Bookmark = { readonly session: { readonly [key: string]: unknown } } & {
  readonly [key: string]: unknown;
};

/** What the spec reads of game.model and game.position. */
type Settled = { readonly path: string; readonly loading: number };

/**
 * The game page frame.
 *
 * @param page - The test page.
 * @returns The frame.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * Where the game stands: its path and its loading progress, read on the game page.
 *
 * @param page - The test page.
 * @returns The path and `session.loading`, or a pending marker while the page is not ready.
 */
async function settled(page: Page): Promise<Settled> {
  try {
    const json = await gameFrame(page).evaluate(async () => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { source(id: string): { read(input: object): Promise<unknown> } };
        }
      ).registry;
      const position = (await registry.source("game.position").read({})) as { path: string };
      const model = (await registry.source("game.model").read({})) as {
        session: { loading: number };
      };
      return JSON.stringify({ path: position.path, loading: model.session.loading });
    });
    return JSON.parse(json) as Settled;
  } catch {
    return { path: "pending", loading: 0 };
  }
}

/**
 * Restores the game's own bookmark with `session.taps` set: a commit of one session patch.
 *
 * @param page - The test page.
 * @param taps - The taps value to commit.
 */
async function commitTaps(page: Page, taps: number): Promise<void> {
  await gameFrame(page).evaluate(async count => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { command(id: string): { run(input: object): Promise<{ value: unknown }> } };
      }
    ).registry;
    const { value } = await registry.command("game.bookmark").run({});
    const bookmark = value as Bookmark;
    const changed = { ...bookmark, session: { ...bookmark.session, taps: count } };
    await registry.command("game.restore").run({ bookmark: changed });
  }, taps);
}

/**
 * Makes State's Last commit a known one: once the game rests at home with its assets loaded, two
 * restores set `session.taps` to 41, then 42. The second commit is diffed against a baseline that
 * already holds 41, so it is exactly `replace /session/taps 41 → 42`, however the boot commits
 * and the first restore were grouped. It touches the masked Session card only.
 *
 * @param tools - The tools driver.
 */
async function showKnownCommit(tools: Tools): Promise<void> {
  const { page } = tools;
  const list = tools.host("state").locator("[data-part=patch-list]");
  const patches = list.locator("[data-part=patches] > li");
  await expect.poll(() => settled(page), { timeout: 30_000 }).toEqual({ path: "home", loading: 1 });

  await commitTaps(page, 41);
  await expect(patches.filter({ hasText: "/session/taps" })).toContainText("41");
  await commitTaps(page, 42);
  await expect(patches).toHaveCount(1);
  await expect(patches.first()).toHaveText(/^replace\s*\/session\/taps\s*41\s*→\s*42$/);
  await expect(list.locator("[data-part=count]")).toHaveText("1 patch");
}

test.describe("baseline", () => {
  test.use({ pinnedDevice: false });

  for (const { id, label } of WORKSPACES) {
    test(`${label} workspace`, async ({ tools }) => {
      await tools.show(id);
      if (id === "state") await showKnownCommit(tools);
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
