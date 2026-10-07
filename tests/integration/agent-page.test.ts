import { defineSource } from "@moku-labs/game/inspect";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "../../src/agent";
import { startTinyScreenGame, type TinyScreenGame } from "../fixtures/tiny-screen-game";

// ─────────────────────────────────────────────────────────────────────────────
// The engine page agent `@moku-labs/editor/agent/page` (D-49): the default export
// the engine's startPage calls after the game started, in dev only. It starts the
// agent core with bridge and capture on the running game and sets
// `globalThis.editor`. The page is a stubbed `location`, and there is no editor
// server: every hello fails, so the bridge reports `lost` and retries until the
// editor stops.
// ─────────────────────────────────────────────────────────────────────────────

/** The editor app the agent leaves on `globalThis`, as far as these tests read it. */
type PageEditor = {
  readonly registry: {
    manifest(): {
      readonly game: string;
      readonly sources: readonly { readonly id: string }[];
      readonly commands: readonly { readonly id: string }[];
    };
  };
  readonly bridge: { status(): { readonly kind: string } };
  stop(): Promise<void>;
};

/** The game's `.dev` module: one source the manifest lists. */
const tinyDev: Registry.DevModule = {
  sources: [
    defineSource({ id: "tiny.page", title: "Page", input: {}, changes: "frame", read: () => 1 })
  ]
};

/**
 * The editor the agent left on `globalThis`.
 *
 * @returns The editor app.
 */
function editorOnPage(): PageEditor {
  return Reflect.get(globalThis, "editor");
}

/**
 * The page agent module, imported fresh by each test that needs it.
 *
 * @returns Its default export.
 */
async function loadAgent() {
  const module = await import("../../src/agent-page");
  return module.default;
}

let game: TinyScreenGame;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  game = await startTinyScreenGame();
  // A page URL for the hello, and no editor server: every hello fails, the bridge retries.
  vi.stubGlobal("location", { href: "http://127.0.0.1:9/" });
  // The agent logs to the console (its default sink); nothing here reads it.
  for (const level of ["debug", "info", "log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no editor server"));
});

afterEach(async () => {
  const editor = Reflect.get(globalThis, "editor");
  Reflect.deleteProperty(globalThis, "editor");
  await editor?.stop?.().catch(() => undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await game.stop();
});

describe("agent/page (D-49)", () => {
  it("has no side effect on import: nothing on globalThis, no hello", async () => {
    const agent = await loadAgent();
    expect(typeof agent).toBe("function");
    expect(Reflect.has(globalThis, "editor")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("starts the agent core with bridge and capture on the game: globalThis.editor names the page and lists the dev module", async () => {
    const agent = await loadAgent();
    await agent({ app: game.app, name: "tiny", modules: [tinyDev] });

    const editor = editorOnPage();
    const manifest = editor.registry.manifest();
    expect(manifest.game).toBe("tiny");
    expect(manifest.sources.map(source => source.id)).toContain("tiny.page");
    expect(manifest.commands.map(command => command.id)).toContain("editor.capture");
    await vi.waitFor(() => expect(editor.bridge.status().kind).toBe("lost"));
  });

  it("ignores a module without sources and commands", async () => {
    const agent = await loadAgent();
    await agent({ app: game.app, name: "tiny", modules: [{ helper: () => 1 }, tinyDev] });
    expect(
      editorOnPage()
        .registry.manifest()
        .sources.map(source => source.id)
    ).toContain("tiny.page");
  });

  it("stop() ends the bridge's retries", async () => {
    vi.useFakeTimers();
    const agent = await loadAgent();
    await agent({ app: game.app, name: "tiny", modules: [] });
    await vi.advanceTimersByTimeAsync(5000);
    const tries = fetchSpy.mock.calls.length;
    expect(tries).toBeGreaterThan(1);

    await editorOnPage().stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(tries);
  });

  it("called again (a hot re-run of .moku/main.ts), stops the last editor before the next one starts", async () => {
    const agent = await loadAgent();
    const order: string[] = [];
    const previous = {
      stop: vi.fn(() => {
        order.push(Reflect.get(globalThis, "editor") === previous ? "stop old" : "stop late");
        return Promise.resolve();
      })
    };
    Reflect.set(globalThis, "editor", previous);

    await agent({ app: game.app, name: "tiny", modules: [tinyDev] });
    expect(previous.stop).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["stop old"]);
    const first = editorOnPage();
    expect(first).not.toBe(previous);

    await agent({ app: game.app, name: "tiny again", modules: [tinyDev] });
    const second = editorOnPage();
    expect(second).not.toBe(first);
    expect(second.registry.manifest().game).toBe("tiny again");
  });
});
