/**
 * @file The State workspace (spec 15-stateView) in a real browser, on the frozen merge-game: the
 * Player and Session JSON trees (default depth, click, Expand all, Collapse all, the keys
 * ↑/↓/←/→/Home/End), the commit a real tap on the game canvas makes with its exact patches and
 * the changed rows in the trees, the Runner card (path, flow · node, stack, link, tainted, last
 * edge, what the gate waits for), the tainted tag after a cheat, the "reloaded" note after the
 * game page reloads, "Show N more" paging and "+N more patches" on a long list, and the workspace
 * scrolling inside its own area.
 *
 * Ground truth is read from the game page: the registry the editor agent exposes there
 * (`globalThis.editor`) answers the same sources the tools page watches.
 */
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A JSON value. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The parts of `game.model` this spec reads. */
type Model = {
  readonly player: {
    readonly merge: {
      readonly board: { readonly items: Json[] };
      readonly energy: { readonly value: number; readonly countedAt: number };
      readonly generators: { readonly sawmill: { readonly charges: number } };
      readonly inventory: Json[];
      readonly nextItemId: number;
    };
  } & { readonly [key: string]: Json };
  readonly session: { readonly taps: number; readonly selected: string } & {
    readonly [key: string]: Json;
  };
};

/** `game.position`. */
type Position = {
  readonly path: string;
  readonly flow: string;
  readonly node: string;
  readonly waiting: string[];
};

/** Game-frame warnings a reload provokes that are not editor defects (see game.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

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
 * Reads a registry source of the game page directly.
 *
 * @param page - The test page.
 * @param id - The source id.
 * @param input - The source input.
 * @returns The value.
 */
async function readSource<T>(page: Page, id: string, input: object = {}): Promise<T> {
  const json = await gameFrame(page).evaluate(
    async ([source, value]) => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { source(id: string): { read(input: object): Promise<unknown> } };
        }
      ).registry;
      return JSON.stringify(await registry.source(source).read(value));
    },
    [id, input] as const
  );
  return JSON.parse(json) as T;
}

/**
 * Runs a registry command on the game page, the way the palette's game commands do.
 *
 * @param page - The test page.
 * @param id - The command id.
 * @param input - The command input.
 * @returns The run value.
 */
async function runCommand<T>(page: Page, id: string, input: object = {}): Promise<T> {
  const json = await gameFrame(page).evaluate(
    async ([command, value]) => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { command(id: string): { run(input: object): Promise<{ value: unknown }> } };
        }
      ).registry;
      const ran = await registry.command(command).run(value);
      return JSON.stringify(ran.value);
    },
    [id, input] as const
  );
  return JSON.parse(json) as T;
}

/**
 * The game position path, "pending" while the game page reloads.
 *
 * @param page - The test page.
 * @returns The path.
 */
async function gamePath(page: Page): Promise<string> {
  try {
    const position = await readSource<Position>(page, "game.position");
    return position.path;
  } catch {
    return "pending";
  }
}

/**
 * Taps a point of a keyed game element with the real mouse on the game canvas.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @param fx - Horizontal fraction of the rect.
 * @param fy - Vertical fraction of the rect.
 */
async function tapGame(page: Page, key: string, fx = 0.5, fy = 0.5): Promise<void> {
  await expect
    .poll(async () => (await readSource<Rect | null>(page, "game.rect", { key })) !== null)
    .toBe(true);
  const rect = await readSource<Rect>(page, "game.rect", { key });
  const box = await page.locator("iframe").first().boundingBox();
  if (box === null) throw new Error("no iframe box");
  const scale = box.width / (await gameFrame(page).evaluate(() => innerWidth));
  await page.mouse.click(
    box.x + (rect.x + rect.w * fx) * scale,
    box.y + (rect.y + rect.h * fy) * scale
  );
}

/**
 * Shows Game and waits for the stage to dock the frame.
 *
 * @param tools - The driver.
 */
async function showGame(tools: Tools): Promise<void> {
  const page = tools.page;
  await tools.show("game");
  await expect
    .poll(async () => {
      const slot = await tools.host("game").locator("[data-part=slot]").boundingBox();
      const frame = await page.locator("iframe").first().boundingBox();
      return slot !== null && frame !== null && Math.abs(slot.x - frame.x) < 1;
    })
    .toBe(true);
}

/**
 * Real taps: Play, then the sawmill generator on the board. Returns the model before the sawmill
 * tap and after its commit.
 *
 * @param tools - The driver.
 * @returns The two models.
 */
async function tapSawmill(tools: Tools): Promise<{ before: Model; after: Model }> {
  const page = tools.page;
  await showGame(tools);
  await expect.poll(() => gamePath(page)).toBe("home");
  await tapGame(page, "play");
  await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
  const before = await readSource<Model>(page, "game.model");
  await tapGame(page, "boardSlot", 1 / 6, 1 / 6);
  await expect
    .poll(async () => chargesOf(await readSource<Model>(page, "game.model")))
    .toBe(before.player.merge.generators.sawmill.charges - 1);
  const after = await readSource<Model>(page, "game.model");
  return { before, after };
}

/**
 * The model's player merge part.
 *
 * @param model - A game.model value.
 * @returns `player.merge`.
 */
function merge(model: Model): Model["player"]["merge"] {
  return model.player.merge;
}

/**
 * The sawmill charges of a model.
 *
 * @param model - A game.model value.
 * @returns The charges.
 */
function chargesOf(model: Model): number {
  return model.player.merge.generators.sawmill.charges;
}

/**
 * The State host.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function state(page: Page): Locator {
  return page.locator("[data-workspace-host=state]");
}

/**
 * A JSON tree of the State workspace.
 *
 * @param page - The test page.
 * @param root - "Player" or "Session".
 * @returns The locator.
 */
function jsonTree(page: Page, root: "Player" | "Session"): Locator {
  return state(page).getByRole("tree", { name: root });
}

/**
 * A tree row by its JSON pointer.
 *
 * @param page - The test page.
 * @param pointer - The pointer, e.g. "/player/merge".
 * @returns The locator.
 */
function row(page: Page, pointer: string): Locator {
  return state(page).locator(`[role=treeitem][data-pointer="${pointer}"]`);
}

/**
 * The compact JSON text the view prints for a value.
 *
 * @param value - The value.
 * @returns The text.
 */
function compact(value: Json): string {
  return JSON.stringify(value);
}

/**
 * Counts the rows a fully expanded tree of a value has.
 *
 * @param value - The value.
 * @returns The node count, the value itself included.
 */
function nodeCount(value: Json): number {
  if (Array.isArray(value))
    return 1 + value.reduce<number>((sum, item) => sum + nodeCount(item), 0);
  if (value !== null && typeof value === "object") {
    return 1 + Object.values(value).reduce<number>((sum, item) => sum + nodeCount(item), 0);
  }
  return 1;
}

/**
 * The pointer of the focused element.
 *
 * @param page - The test page.
 * @returns The pointer, or "" when the focus is not on a tree row.
 */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.pointer ?? "");
}

/**
 * The patch rows as `op pointer change` texts.
 *
 * @param page - The test page.
 * @returns The texts.
 */
async function patchTexts(page: Page): Promise<string[]> {
  return state(page)
    .locator("[data-part=patch-list] [data-part=patches] > li")
    .evaluateAll(items =>
      items.map(item => {
        const op = item.querySelector("[data-tag]")?.textContent ?? "";
        const pointer = item.querySelector("[data-part=pointer]")?.textContent ?? "";
        const change = item.querySelector("[data-part=change]")?.textContent ?? "";
        return `${op} ${pointer} ${change}`;
      })
    );
}

test.describe("state · trees", () => {
  test("the Player tree shows game.model at depth 2; a row click toggles; Expand all and Collapse all", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    const model = await readSource<Model>(page, "game.model");
    const player = jsonTree(page, "Player");
    await expect(row(page, "/player")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "/player/merge")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "/player/merge/board")).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "/player/merge/board").locator("[data-part=summary]")).toHaveText("{3}");
    await expect(row(page, "/player/merge/inventory").locator("[data-part=summary]")).toHaveText(
      `[${model.player.merge.inventory.length}]`
    );
    await expect(row(page, "/player/merge/nextItemId").locator("[data-part=value]")).toHaveText(
      String(model.player.merge.nextItemId)
    );
    const settings = model.player.settings as { readonly locale: Json };
    await expect(row(page, "/player/settings/locale").locator("[data-part=value]")).toHaveText(
      compact(settings.locale)
    );
    await expect(row(page, "/player/merge/board/cols")).toHaveCount(0);

    // A click opens a closed row and shows its children; a second click closes it.
    await row(page, "/player/merge/board").click();
    await expect(row(page, "/player/merge/board")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "/player/merge/board/cols").locator("[data-part=value]")).toHaveText(
      "3"
    );
    await expect(row(page, "/player/merge/board/cols")).toHaveAttribute("aria-level", "4");
    await row(page, "/player/merge/board").click();
    await expect(row(page, "/player/merge/board/cols")).toHaveCount(0);

    // Expand all opens every container; Collapse all closes them down to the root row.
    await state(page).locator("[data-part=player-card] [data-part=expand-all]").click();
    await expect(player.locator("[role=treeitem][aria-expanded=false]")).toHaveCount(0);
    await expect(player.locator("[role=treeitem]")).toHaveCount(nodeCount(model.player as Json));
    await state(page).locator("[data-part=player-card] [data-part=collapse-all]").click();
    await expect(player.locator("[role=treeitem]")).toHaveCount(1);
    await expect(row(page, "/player")).toHaveAttribute("aria-expanded", "false");

    // The Session tree: game.model session values, "not saved".
    const session = jsonTree(page, "Session");
    await expect(state(page).locator("[data-part=session-card] [data-tag=mut]")).toHaveText(
      "not saved"
    );
    for (const [key, value] of Object.entries(model.session)) {
      await expect(
        session.locator(`[data-pointer="/session/${key}"] [data-part=value]`)
      ).toHaveText(compact(value));
    }
  });

  test("keys: ↓/↑ move, ← closes then leaves, → opens then enters, Home and End jump", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    await expect(row(page, "/player")).toHaveAttribute("tabindex", "0");
    await row(page, "/player").focus();
    expect(await focused(page)).toBe("/player");

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focused(page)).toBe("/player/merge");
    await expect(row(page, "/player/merge")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "/player/merge")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "/player/merge")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("/player/merge/board");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => focused(page)).toBe("/player/merge");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => focused(page)).toBe("/player");

    const last = await jsonTree(page, "Player")
      .locator("[role=treeitem]")
      .last()
      .getAttribute("data-pointer");
    await page.keyboard.press("End");
    await expect.poll(() => focused(page)).toBe(last);
    await page.keyboard.press("Home");
    await expect.poll(() => focused(page)).toBe("/player");
  });
});

test.describe("state · commit and runner", () => {
  test("a real tap on the sawmill makes one commit with its exact patches; the trees mark the rows", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    const { before, after } = await tapSawmill(tools);
    await tools.show("state");

    const expected = [
      `add /player/merge/board/items/0 ${compact(merge(after).board.items[0] ?? "missing")}`,
      `replace /player/merge/energy/value ${merge(before).energy.value} → ${merge(after).energy.value}`,
      `replace /player/merge/energy/countedAt ${merge(before).energy.countedAt} → ${merge(after).energy.countedAt}`,
      `replace /player/merge/generators/sawmill/charges ${merge(before).generators.sawmill.charges} → ${merge(after).generators.sawmill.charges}`,
      `replace /player/merge/nextItemId ${merge(before).nextItemId} → ${merge(after).nextItemId}`,
      `replace /session/taps ${before.session.taps} → ${after.session.taps}`,
      `replace /session/selected ${compact(before.session.selected)} → ${compact(after.session.selected)}`
    ];
    await expect.poll(() => patchTexts(page)).toEqual(expected);
    const list = state(page).locator("[data-part=patch-list]");
    await expect(list.locator("[data-part=count]")).toHaveText(`${expected.length} patches`);
    await expect(list.locator("[data-part=meta]")).toHaveText("rng advanced");
    await expect(list.locator("[data-part=frame]")).toHaveText(/^~f\d+$/);
    const frame = (await list.locator("[data-part=frame]").textContent()) ?? "";
    await expect(state(page).locator("[data-part=title]")).toHaveText(
      new RegExp(String.raw`^State · player and session at frame \d+ · last commit ${frame}$`)
    );
    await expect(list.locator("li[data-op=add] [data-tag]")).toHaveText("add");

    // The changed rows: "was N" on replaced leaves, "added" on the new item, marks on ancestors.
    await expect(row(page, "/player/merge/generators")).toHaveAttribute("data-has-change", "");
    await state(page).locator("[data-part=player-card] [data-part=expand-all]").click();
    const charges = row(page, "/player/merge/generators/sawmill/charges");
    await expect(charges).toHaveAttribute("data-changed", "");
    await expect(charges.locator("[data-part=was]")).toHaveText(
      `was ${merge(before).generators.sawmill.charges}`
    );
    await expect(charges.locator("[data-part=value]")).toHaveText(
      String(merge(after).generators.sawmill.charges)
    );
    await expect(row(page, "/player/merge/board/items/0").locator("[data-part=added]")).toHaveText(
      "added"
    );
    await expect(row(page, "/session/taps").locator("[data-part=was]")).toHaveText(
      `was ${before.session.taps}`
    );
    await expect(row(page, "/player/merge/wallet")).not.toHaveAttribute("data-has-change");
  });

  test("the Runner card follows game.position: path, stack, link, clean, last edge and the gate", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    const runner = state(page).locator("[data-part=runner-card]");
    const value = (label: string) =>
      runner.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("+ dd");
    const home = await readSource<Position>(page, "game.position");
    await expect(value("path")).toHaveText(home.path);
    await expect(value("flow · node")).toHaveText(`${home.flow} · ${home.node}`);
    await expect(value("stack")).toHaveText("main/home");
    await expect(value("link")).toHaveText(/^live at frame \d+$/);
    await expect(value("tainted")).toHaveText("clean");
    await expect(value("last edge")).toHaveText("—");
    await expect(runner.locator("[data-part=gate-title]")).toHaveText(
      `Gate waits for ${home.waiting.length}`
    );
    await expect(runner.locator("[data-part=gate] li")).toHaveText(home.waiting);

    await tapSawmill(tools);
    await tools.show("state");
    const board = await readSource<Position>(page, "game.position");
    await expect(value("path")).toHaveText("board/awaitIntent");
    await expect(value("flow · node")).toHaveText("board · awaitIntent");
    await expect(value("stack")).toHaveText("main/board › board/awaitIntent");
    // The last history entry: "path · outcome" and its payload when it has one.
    await expect
      .poll(async () => {
        const history = await readSource<{ path: string; outcome?: string; payload?: Json }[]>(
          page,
          "game.history",
          { last: 1 }
        );
        const entry = history.at(-1);
        if (entry === undefined) return "no history";
        const edge = `${entry.path} · ${entry.outcome ?? "—"}`;
        const expected =
          entry.payload === undefined || entry.payload === null
            ? edge
            : `${edge} ${compact(entry.payload)}`;
        return ((await value("last edge").textContent()) ?? "") === expected ? "ok" : expected;
      })
      .toBe("ok");
    await expect(value("last edge")).toHaveText(/^board\//);
    await expect(runner.locator("[data-part=gate-title]")).toHaveText(
      `Gate waits for ${board.waiting.length}`
    );
    await expect(runner.locator("[data-part=gate] li")).toHaveText(board.waiting);
    await expect(value("tainted")).toHaveText("clean");
  });
});

test.describe("state · reload, taint, paging", () => {
  test("Reload in Game resets the commit: the note says the game page reloaded", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await tapSawmill(tools);
    await tools.show("state");
    await expect(state(page).locator("[data-part=patch-list] [data-part=count]")).toBeVisible();

    await showGame(tools);
    await page.evaluate(() => {
      const notes: string[] = [];
      Reflect.set(globalThis, "__e2eNotes", notes);
      const read = (): void => {
        const text = document.querySelector(
          "[data-workspace-host=state] [data-part=patch-list] [data-part=empty]"
        )?.textContent;
        if (text && notes.at(-1) !== text) notes.push(text);
      };
      new MutationObserver(read).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });
    });
    await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
    await tools.host("game").locator("[data-game=toolbar] [data-part=reload]").click();
    await expect
      .poll(async () => {
        try {
          return await gameFrame(page).evaluate(() => Reflect.get(globalThis, "__e2eMark") === 1);
        } catch {
          return true;
        }
      })
      .toBe(false);
    await expect.poll(() => gamePath(page)).toBe("home");
    // The reload resets the tracker with the note; the new game's boot commit then replaces it.
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, "__e2eNotes") as string[]))
      .toContain("Game page reloaded · waiting for the next commit");
    await tools.show("state");
    await expect(
      state(page).locator("[data-part=runner-card] [data-part=mono]").first()
    ).toHaveText("home");

    // "Reload game and restore state" from the palette restores the checkpoint, a cheat: tainted.
    const tainted = state(page)
      .locator("[data-part=runner-card] dt", { hasText: /^tainted$/ })
      .locator("+ dd");
    await expect(tainted).toHaveText("clean");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator("dialog[data-ui=palette]");
    await palette.getByRole("combobox", { name: "Search" }).fill("Reload game and restore state");
    await palette
      .getByRole("option", { name: /Reload game and restore state/ })
      .first()
      .click();
    await expect(palette).toBeHidden();
    await expect(tainted.locator("[data-tag=err]")).toHaveText("tainted", { timeout: 30_000 });
  });

  test("a cheat taints the session; a long list pages with Show N more and the patches cap", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    const runner = state(page).locator("[data-part=runner-card]");
    const tainted = runner.locator("dt", { hasText: /^tainted$/ }).locator("+ dd");
    await expect(tainted).toHaveText("clean");

    // game.restore with a bookmark is a cheat: a 260-slot inventory makes the list long.
    const bookmark = await runCommand<{ player: Model["player"] }>(page, "game.bookmark");
    const slots = 260;
    // eslint-disable-next-line unicorn/no-null -- an empty inventory slot is JSON null
    const inventory = Array.from({ length: slots }, () => null);
    const changed = {
      ...bookmark,
      player: { ...bookmark.player, merge: { ...bookmark.player.merge, inventory } }
    };
    const current = await readSource<Model>(page, "game.model");
    const before = current.player.merge.inventory.length;
    await runCommand(page, "game.restore", { bookmark: changed });
    await expect(tainted.locator("[data-tag=err]")).toHaveText("tainted");

    // The commit adds slots `before`…259: 200 shown, the rest counted.
    const list = state(page).locator("[data-part=patch-list]");
    await expect(list.locator("[data-part=count]")).toHaveText(`${slots - before} patches`);
    await expect(list.locator("[data-part=patches] > li")).toHaveCount(200);
    await expect(list.locator("[data-part=more]")).toHaveText(
      `+${slots - before - 200} more patches`
    );

    // The inventory row pages its children 100 at a time.
    const inventoryRow = row(page, "/player/merge/inventory");
    await expect(inventoryRow.locator("[data-part=summary]")).toHaveText(`[${slots}]`);
    await inventoryRow.click();
    const children = state(page).locator(
      '[role=treeitem][data-pointer^="/player/merge/inventory/"]'
    );
    await expect(children).toHaveCount(100);
    const more = jsonTree(page, "Player").locator("[data-part=show-more]");
    await expect(more).toHaveText("Show 100 more");
    await more.click();
    await expect(children).toHaveCount(200);
    await expect(more).toHaveText(`Show ${slots - 200} more`);
    await more.click();
    await expect(children).toHaveCount(slots);
    await expect(more).toHaveCount(0);
    await expect(row(page, `/player/merge/inventory/${slots - 1}`)).toBeAttached();

    // The workspace scrolls inside its own area to the last slot; the page does not scroll.
    const lastSlot = row(page, `/player/merge/inventory/${slots - 1}`);
    await lastSlot.scrollIntoViewIfNeeded();
    await expect(lastSlot).toBeInViewport();
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
    ).toBeLessThanOrEqual(0);
  });
});
