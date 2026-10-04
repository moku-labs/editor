/**
 * @file Exploratory QA regressions across workspaces: a save asked while a write is in flight
 * (Files and the Flow Code tab), a game source saved while paused, the watch bookkeeping under
 * rapid workspace switching and a game reload, Esc unwinding the palette over a workspace overlay,
 * and two tools tabs on one hub. Below 600 px the Files tree and the Flow Inspector are drawers
 * that start collapsed: a test opens them before it works in them.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import { expect, openTools, test, WORKSPACES } from "./fixtures";

/** The game root the bin serves (e2e/prepare-game.ts copies the fixture there). */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The scratch folder of this spec inside the game root. */
const DIR = "qa-cross";

/** Warnings a game reload logs while its textures load again (see files.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** A JSON-RPC frame of the tools socket, as far as these tests read it. */
type Frame = {
  id?: number;
  channel?: string;
  method?: string;
  params?: { sub?: number };
  session?: string;
};

/**
 * Parses one socket frame; a frame that is not JSON reads as empty.
 *
 * @param message - The raw frame.
 * @returns The frame.
 */
function parse(message: string | Buffer): Frame {
  try {
    return JSON.parse(String(message)) as Frame;
  } catch {
    return {};
  }
}

/** The gate on the answers of `files.write`. */
type WriteGate = {
  /** The write requests whose answer is held. */
  held(): number;
  /** Delivers the held answers and stops holding. */
  release(): void;
};

/**
 * Routes the tools socket and holds the hub's answer to every `files.write` until `release()`,
 * so a test can act while a save is in flight. Every other frame passes through.
 *
 * @param page - The test page, before the tools page opens.
 * @returns The gate.
 */
async function holdWrites(page: Page): Promise<WriteGate> {
  const writes = new Set<number>();
  const held: { socket: WebSocketRoute; message: string | Buffer }[] = [];
  let holding = true;
  await page.routeWebSocket(/\/__editor\/ws/, socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      const frame = parse(message);
      if (frame.channel === "files" && frame.method === "write" && frame.id !== undefined) {
        writes.add(frame.id);
      }
      server.send(message);
    });
    server.onMessage(message => {
      const { id } = parse(message);
      if (holding && id !== undefined && writes.has(id)) held.push({ socket, message });
      else socket.send(message);
    });
  });
  return {
    held: () => held.length,
    release: () => {
      holding = false;
      for (const entry of held.splice(0)) entry.socket.send(entry.message);
    }
  };
}

/**
 * Reads a file of the game root.
 *
 * @param rel - Root-relative path.
 * @returns The text, or undefined when missing.
 */
async function readGameFile(rel: string): Promise<string | undefined> {
  return readFile(path.join(GAME_ROOT, rel), "utf8").catch(() => undefined);
}

/**
 * The Files workspace host.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function files(page: Page): Locator {
  return page.locator("[data-workspace-host=files]");
}

/**
 * The Flow inspector.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function inspector(page: Page): Locator {
  return page.locator("[data-workspace-host=flow] [data-flow=inspector]");
}

/**
 * Shows a side panel's content: below 600 px it is a drawer that starts collapsed (the Files tree
 * also shuts when a file opens), so its rail button opens it; docked it already shows.
 *
 * @param page - The test page.
 * @param id - The panel id, e.g. "files.tree".
 */
async function expandSide(page: Page, id: string): Promise<void> {
  const panel = page.locator(`aside[data-side-panel="${id}"]`);
  await expect(panel).toBeVisible();
  // The panel settles into drawer mode once its container is measured.
  await expect
    .poll(() =>
      panel.evaluate(element => {
        const width = element.parentElement?.getBoundingClientRect().width ?? 0;
        const isDrawer = element.dataset.overlay !== undefined;
        return width > 0 && width < 600 === isDrawer;
      })
    )
    .toBe(true);
  if ((await panel.getAttribute("data-state")) === "collapsed") {
    await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
  }
  await expect(panel).toHaveAttribute("data-state", "expanded");
}

/**
 * Shows a workspace with the rail.
 *
 * @param page - The test page.
 * @param ws - The workspace id.
 */
async function show(page: Page, ws: string): Promise<void> {
  await page.locator(`[data-ui=rail] button[data-workspace=${ws}]`).click();
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", ws);
}

/**
 * The session a tools page follows: the session chip from 900 px, the link pill's tooltip in the
 * compact top bar below 900 px ("… · session s-7f3a · connected 22:41:07", round 2 R1).
 *
 * @param target - A tools page.
 * @returns The session id, "" while none shows.
 */
async function sessionOf(target: Page): Promise<string> {
  const chip = target.locator("[data-ui=session-chip] button");
  if ((await chip.count()) > 0) return ((await chip.textContent()) ?? "").trim();
  const title = (await target.locator("[data-ui=link-pill]").getAttribute("title")) ?? "";
  return /session (s-[0-9a-f]{4})/.exec(title)?.[1] ?? "";
}

test.describe("qa · a save during a save", () => {
  test.beforeEach(async () => {
    await rm(path.join(GAME_ROOT, DIR), { recursive: true, force: true });
    await mkdir(path.join(GAME_ROOT, DIR), { recursive: true });
    await writeFile(path.join(GAME_ROOT, DIR, "save.md"), "# start\n");
  });

  test.afterEach(async () => {
    await rm(path.join(GAME_ROOT, DIR), { recursive: true, force: true });
  });

  test("Files: ⌘S while a write is in flight saves the newer buffer once it lands", async ({
    page
  }) => {
    const rel = `${DIR}/save.md`;
    const gate = await holdWrites(page);
    await openTools(page, "#files");
    const host = files(page);
    await expandSide(page, "files.tree");
    await host.locator(`[role=treeitem][data-path="${DIR}"]`).click();
    await host.locator(`[role=treeitem][data-path="${rel}"]`).click();
    const bar = host.locator("[data-part=file-bar]");
    await bar.getByRole("radio", { name: "Source" }).click();
    await bar.getByRole("button", { name: "Edit here" }).click();
    const area = host.getByRole("textbox", { name: `Edit ${rel}` });

    await area.fill("# first\n");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => gate.held()).toBe(1);
    await area.fill("# second\n");
    await page.keyboard.press("ControlOrMeta+s");
    gate.release();

    await expect.poll(() => readGameFile(rel)).toBe("# second\n");
    await expect(area).toHaveValue("# second\n");
    const close = host.locator(`[role=tab][title="${rel}"]`).locator("..").locator("[data-close]");
    await expect(close).not.toHaveAttribute("data-modified", "");
  });

  test("Flow Code: text typed while the save is in flight stays the draft and saves next", async ({
    page,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const gate = await holdWrites(page);
    await openTools(page, "#flow");
    await page
      .locator('[data-workspace-host=flow] [data-flow=node-card][data-key="main/home"]')
      .click();
    await expandSide(page, "flow.inspector");
    await inspector(page).getByRole("tab", { name: "Code" }).click();
    const tab = inspector(page).locator("[data-flow=code-tab]");
    const file = (
      (await tab.locator("[data-part=file-bar] [data-part=path]").textContent()) ?? ""
    ).trim();
    expect(file).toMatch(/\.tsx?$/);
    const original = (await readGameFile(file)) ?? "";
    expect(original.length).toBeGreaterThan(0);
    const first = `${original}// qa first\n`;
    const second = `${first}// qa typed during the save\n`;
    try {
      await tab.locator("[data-action=edit]").click();
      const editor = tab.getByRole("textbox", { name: `Edit ${file}` });
      await editor.fill(first);
      await editor.press("ControlOrMeta+s");
      await expect.poll(() => gate.held()).toBe(1);
      await editor.fill(second);
      gate.release();

      await expect.poll(() => readGameFile(file)).toBe(first);
      await expect(tab.locator("[data-part=result]")).toHaveText(
        "✓ Saved · game reloaded · state restored from the last checkpoint",
        { timeout: 30_000 }
      );
      await expect(editor).toHaveValue(second);
      await editor.press("ControlOrMeta+s");
      await expect.poll(() => readGameFile(file)).toBe(second);
      await expect(tab.locator("[data-part=conflict]")).toHaveCount(0);
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: 30_000
      });
    } finally {
      await writeFile(path.join(GAME_ROOT, file), original);
    }
  });
});

test.describe("qa · a save while paused", () => {
  test("Files: a game source saved while paused reloads the game and keeps it paused", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    const rel = "nodes/merge.ts";
    const original = (await readGameFile(rel)) ?? "";
    expect(original.length).toBeGreaterThan(0);
    const pill = page.locator("[data-ui=link-pill]");
    const pause = page.locator("[data-ui=top-bar] [data-action=pause]");
    await pause.click();
    await expect(pill).toHaveAttribute("data-kind", "paused");
    const old = await sessionOf(page);
    expect(old).toMatch(/^s-[0-9a-f]{4}$/);
    try {
      await tools.show("files");
      const host = files(page);
      await expandSide(page, "files.tree");
      await host.locator('[role=treeitem][data-path="nodes"]').click();
      await host.locator(`[role=treeitem][data-path="${rel}"]`).click();
      await host.locator("[data-part=file-bar]").getByRole("button", { name: "Edit here" }).click();
      await host.getByRole("textbox", { name: `Edit ${rel}` }).fill(`${original}// qa paused\n`);
      await page.keyboard.press("ControlOrMeta+s");

      await expect.poll(() => readGameFile(rel)).toBe(`${original}// qa paused\n`);
      await expect.poll(() => sessionOf(page), { timeout: 30_000 }).not.toBe(old);
      await expect(pill).toHaveAttribute("data-kind", "paused", { timeout: 30_000 });
      await expect(pause).toHaveText("Resume");
    } finally {
      await writeFile(path.join(GAME_ROOT, rel), original);
    }
  });
});

test.describe("qa · watches across workspaces", () => {
  test("rapid switching and a game reload leave one watch per source, no duplicate values", async ({
    page,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const sent: Frame[] = [];
    const received: Frame[] = [];
    page.on("websocket", socket => {
      if (!socket.url().includes("/__editor/ws")) return;
      socket.on("framesent", frame => sent.push(parse(frame.payload)));
      socket.on("framereceived", frame => received.push(parse(frame.payload)));
    });
    await openTools(page, "#flow");
    const open = (): number =>
      sent.filter(frame => frame.method === "watch").length -
      sent.filter(frame => frame.method === "unwatch").length;
    // Settle every workspace once, then measure Flow at rest.
    for (const { id } of WORKSPACES) await show(page, id);
    await show(page, "flow");
    await expect.poll(open).toBeGreaterThan(0);
    const atRest = open();

    for (let index = 0; index < 36; index += 1) {
      await page.keyboard.press(`ControlOrMeta+${(index % WORKSPACES.length) + 1}`);
    }
    await show(page, "flow");
    await expect.poll(open).toBe(atRest);

    // A game reload: the new session gets its own watches, each source delivers once per value.
    const old = await sessionOf(page);
    expect(old).toMatch(/^s-[0-9a-f]{4}$/);
    await show(page, "game");
    await page.locator("[data-workspace-host=game] [data-game=toolbar] [data-part=reload]").click();
    await show(page, "state");
    await expect.poll(() => sessionOf(page), { timeout: 30_000 }).not.toBe(old);
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: 30_000
    });
    const session = await sessionOf(page);
    const watched = (): Frame[] =>
      sent.filter(frame => frame.method === "watch" && frame.session === session);
    await expect.poll(() => watched().length).toBeGreaterThan(0);
    const subs = watched().map(frame => frame.params?.sub);
    expect(new Set(subs).size).toBe(subs.length);
    const start = received.length;
    await expect
      .poll(() => received.slice(start).filter(frame => frame.method === "value").length)
      .toBeGreaterThan(2);
    // No value of the old session arrives once the new one is attached.
    const stale = received
      .slice(start)
      .filter(frame => frame.method === "value" && frame.session !== session);
    expect(stale).toEqual([]);
  });
});

test.describe("qa · Esc unwinds one layer", () => {
  test.beforeEach(async () => {
    await mkdir(path.join(GAME_ROOT, DIR), { recursive: true });
    await writeFile(path.join(GAME_ROOT, DIR, "esc.md"), "# esc\n");
  });

  test.afterEach(async () => {
    await rm(path.join(GAME_ROOT, DIR), { recursive: true, force: true });
  });

  test("the palette over the Game picker, a Files edit and a close confirm closes first", async ({
    tools
  }) => {
    const page = tools.page;
    const palette = page.locator("dialog[data-ui=palette]");
    await tools.show("game");
    const select = tools
      .host("game")
      .getByRole("button", { name: /^Select/ })
      .first();
    await page.keyboard.press("Shift+ControlOrMeta+c");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-pressed", "false");

    const rel = `${DIR}/esc.md`;
    await tools.show("files");
    const host = files(page);
    await expandSide(page, "files.tree");
    await host.locator("button", { hasText: "↻" }).click();
    await host.locator(`[role=treeitem][data-path="${DIR}"]`).click();
    await host.locator(`[role=treeitem][data-path="${rel}"]`).click();
    const bar = host.locator("[data-part=file-bar]");
    await bar.getByRole("radio", { name: "Source" }).click();
    await bar.getByRole("button", { name: "Edit here" }).click();
    const area = host.getByRole("textbox", { name: `Edit ${rel}` });
    await area.fill("# changed\n");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(area).toBeFocused();
    await expect(area).toHaveValue("# changed\n");
  });
});

test.describe("qa · two tools tabs", () => {
  // Every tools page embeds its own game. Its frame URL carries the page's frame id, and the link
  // prefers the session whose page carries it, so a second tab never takes the first one over.
  test("a second tools tab leaves the first tab on its own game", async ({ tools }) => {
    const page = tools.page;
    const own = await sessionOf(page);
    expect(own).toMatch(/^s-[0-9a-f]{4}$/);
    const second = await page.context().newPage();
    try {
      await openTools(second);
      await expect.poll(() => sessionOf(second)).toMatch(/^s-[0-9a-f]{4}$/);
      await expect.poll(() => sessionOf(second)).not.toBe(own);
      await expect.poll(() => sessionOf(page), { timeout: 5000 }).toBe(own);
    } finally {
      await second.close();
    }
  });
});
