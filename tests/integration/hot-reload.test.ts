import { commands, run } from "@moku-labs/game/control";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src";
import {
  createTinyGame,
  logErrors,
  reloadAgent,
  type Stack,
  shutdown,
  startStack,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Round 2 core over the real wire (R6, R8): the bridge's checkpoint across
// Bun's full reload, the hot reload state from pages to the tools link, and a
// game-side resume that turns the link live again within one heartbeat.
// ─────────────────────────────────────────────────────────────────────────────

/** The sessionStorage key of the bridge checkpoint. */
const CHECKPOINT_KEY = "moku-editor:checkpoint";

let stack: Stack | undefined;

afterEach(async () => {
  await shutdown(stack);
  stack = undefined;
});

/**
 * A Map-backed sessionStorage, stubbed as the page's.
 *
 * @returns The items behind it.
 */
function stubSessionStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => items.get(key) ?? null, // eslint-disable-line unicorn/no-null -- the Storage contract
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    }
  });
  return items;
}

describe("the bridge checkpoint across Bun's full reload (R6)", () => {
  it("a bridge that starts with a stored checkpoint restores it, re-pauses and reports restored", async () => {
    const items = stubSessionStorage();
    stack = await startStack();
    const { link } = stack.tools.app;

    // The old page: the game walks to 5 coins; this is what Bun's beforeFullReload stores.
    await link.run("game.answer", { intent: "play" });
    const ran = await link.run("game.bookmark");
    const bookmark: Json = ran.value;
    const checkpoint = {
      v: 1,
      doc: performance.timeOrigin - 1,
      at: Date.now(),
      frame: 1840,
      paused: true,
      bookmark
    };
    items.set(CHECKPOINT_KEY, JSON.stringify(checkpoint));

    // The new page: a fresh game (0 coins) and a new bridge.
    await reloadAgent(stack, createTinyGame);
    await until(() => link.manifest()?.restored !== undefined, "a manifest with restored");

    expect(link.manifest()?.restored).toEqual({ bookmark: JSON.stringify(bookmark), frame: 1840 });
    expect(stack.game.app.model.store.snapshot().player).toEqual({ coins: 5, visits: 1 });
    await until(() => link.status().kind === "paused", "the restored game paused again");
    expect(items.has(CHECKPOINT_KEY)).toBe(false);
    expect(logErrors(stack.server.app, stack.agent.app, stack.tools.app)).toEqual([]);
  });

  it("a bridge without a checkpoint says nothing about restored", async () => {
    stubSessionStorage();
    stack = await startStack();
    expect(stack.tools.app.link.manifest()).not.toHaveProperty("restored");
  });
});

describe("hot reload from pages to the tools link (R6)", () => {
  it("the link gets the state on attachServer and setHotReload keeps Bun's value", async () => {
    stack = await startStack();
    const { server, tools } = stack;
    const seen: unknown[] = [];
    tools.app.link.onHotReload(state => seen.push(state));

    server.app.pages.attachServer({ development: { hmr: true, console: true } } as never);
    await until(() => tools.app.link.hotReload() !== undefined, "the hotReload notification");

    expect(tools.app.link.hotReload()).toEqual({ hmr: true, owner: "bin" });
    expect(seen).toEqual([{ hmr: true, owner: "bin" }]);
    await expect(tools.app.link.setHotReload(true)).resolves.toBe(true);
    await expect(tools.app.link.setHotReload(false)).resolves.toBe(false);
    expect(tools.app.link.hotReload()).toEqual({ hmr: true, owner: "bin" });
  });

  it("a game's own server is owner server: the switch answers false", async () => {
    stack = await startStack();
    await expect(stack.tools.app.link.setHotReload(true)).resolves.toBe(false);
    expect(stack.tools.app.link.hotReload()).toEqual({ hmr: false, owner: "server" });
  });
});

/**
 * The kind the workspace pill shows.
 *
 * @param host - Where the tools page is mounted.
 * @returns `data-kind` of the pill, or undefined before it renders.
 */
function pillKind(host: ParentNode): string | undefined {
  return host.querySelector<HTMLElement>("[data-ui='link-pill']")?.dataset.kind;
}

describe("a game-side resume (R8)", () => {
  it("turns the link and the pill live within one heartbeat and the frame moves", async () => {
    stack = await startStack();
    const { tools, game, page } = stack;
    const { link } = tools.app;

    await link.run("game.pause");
    await until(() => pillKind(page.root) === "paused", "the pill paused from the editor");

    // The game page resumes itself through its own door, not through the editor. The agent
    // heartbeat runs every 100 ms in the stack: one beat later the pill says live.
    const resumed = await run(game.app, commands.resume);
    expect(resumed.value).toBe(false);
    await until(() => link.status().kind === "live", "live after the game-side resume", 300);
    await until(() => pillKind(page.root) === "live", "the pill live", 300);

    const before = link.status();
    await game.frames(3);
    await until(() => {
      const now = link.status();
      return now.kind === "live" && before.kind === "live" && now.frame > before.frame;
    }, "the frame moves");
    expect(link.status().kind).toBe("live");
  });
});
