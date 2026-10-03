import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogue } from "../../catalogue";
import { buildManifest, currentManifest, gameName, pageInfo } from "../../manifest";
import type { StartedGame, TestCtx } from "../helpers";
import { createCtx, startGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The manifest: descriptors only, game name, page and embedded
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;
let ctx: TestCtx;

beforeEach(async () => {
  game = await startGame();
  ctx = createCtx({ game: game.app, name: "merge-game 0.0.0" });
  buildCatalogue(ctx);
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/**
 * Stubs a page inside a frame.
 *
 * @param options - Page href, whether framed, and the parent origin (a throwing getter when cross-origin).
 * @param options.href - The page URL.
 * @param options.framed - Whether the page has a parent frame.
 * @param options.parentOrigin - The parent origin, or "throws" for a cross-origin parent.
 */
function stubPage(options: { href: string; framed: boolean; parentOrigin: string }): void {
  const origin = new URL(options.href).origin;
  const parentLocation = {
    get origin(): string {
      if (options.parentOrigin === "throws") throw new DOMException("Blocked", "SecurityError");
      return options.parentOrigin;
    }
  };
  const location = { href: options.href, origin };
  // A browser window: `self` is the window itself; `top` is another window inside a frame.
  const window: { self?: unknown; top?: unknown; parent: unknown; location: unknown } = {
    parent: { location: parentLocation },
    location
  };
  window.self = window;
  window.top = options.framed ? { location: parentLocation } : window;

  vi.stubGlobal("location", location);
  vi.stubGlobal("window", window);
  vi.stubGlobal("self", window);
}

describe("buildManifest", () => {
  it("lists every source and command descriptor in state order", () => {
    const manifest = buildManifest(ctx.state, "merge-game 0.0.0");

    expect(manifest.game).toBe("merge-game 0.0.0");
    expect(manifest.sources.map(source => source.id)).toEqual([...ctx.state.sources.keys()]);
    expect(manifest.commands.map(command => command.id)).toEqual([...ctx.state.commands.keys()]);
    expect(manifest.sources).toHaveLength(15);
    expect(manifest.commands).toHaveLength(14);
    expect("panels" in manifest).toBe(false);
  });

  it("carries no functions and is frozen all the way down", () => {
    const manifest = buildManifest(ctx.state, "g");
    const json = structuredClone(manifest);

    expect(json).toEqual(manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.sources)).toBe(true);
    expect(Object.isFrozen(manifest.commands)).toBe(true);
    for (const descriptor of [...manifest.sources, ...manifest.commands]) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.input)).toBe(true);
      expect(Object.values(descriptor).some(value => typeof value === "function")).toBe(false);
    }
  });

  it("describes a source as { id, title, input, changes } and a command as { id, title, input, effect }", () => {
    const manifest = buildManifest(ctx.state, "g");

    expect(manifest.sources.find(source => source.id === "game.history")).toEqual({
      id: "game.history",
      title: "History",
      input: { last: "number?" },
      changes: "edge"
    });
    expect(Object.keys(manifest.commands[0] ?? {})).toEqual(["id", "title", "input", "effect"]);
  });
});

describe("gameName", () => {
  it("uses config.name first", () => {
    vi.stubGlobal("document", { title: "Page title" });

    expect(gameName({ game: game.app, modules: [], name: "merge-game 0.0.0" })).toBe(
      "merge-game 0.0.0"
    );
  });

  it("falls back to the trimmed document.title", () => {
    vi.stubGlobal("document", { title: "  Merge Town  " });

    expect(gameName({ game: game.app, modules: [], name: undefined })).toBe("Merge Town");
  });

  it("falls back to 'game' for an empty title", () => {
    vi.stubGlobal("document", { title: "   " });

    expect(gameName({ game: game.app, modules: [], name: undefined })).toBe("game");
  });

  it("falls back to 'game' without a document (Bun)", () => {
    expect(gameName({ game: game.app, modules: [], name: undefined })).toBe("game");
  });
});

describe("pageInfo", () => {
  it("is '' and not embedded in Bun", () => {
    expect(pageInfo()).toEqual({ page: "", embedded: false });
  });

  it("is the page href, not embedded, in a top-level page", () => {
    stubPage({
      href: "http://127.0.0.1:3000/",
      framed: false,
      parentOrigin: "http://127.0.0.1:3000"
    });

    expect(pageInfo()).toEqual({ page: "http://127.0.0.1:3000/", embedded: false });
  });

  it("is embedded inside a same-origin frame", () => {
    stubPage({
      href: "http://127.0.0.1:3000/",
      framed: true,
      parentOrigin: "http://127.0.0.1:3000"
    });

    expect(pageInfo().embedded).toBe(true);
  });

  it("is not embedded inside a frame of another origin", () => {
    stubPage({
      href: "http://127.0.0.1:3000/",
      framed: true,
      parentOrigin: "http://localhost:4000"
    });

    expect(pageInfo().embedded).toBe(false);
  });

  it("is not embedded when reading the parent origin throws (cross-origin)", () => {
    stubPage({ href: "http://127.0.0.1:3000/", framed: true, parentOrigin: "throws" });

    expect(pageInfo().embedded).toBe(false);
  });

  it("cuts the page URL to 2048 characters", () => {
    const href = `http://127.0.0.1:3000/?q=${"x".repeat(3000)}`;
    stubPage({ href, framed: false, parentOrigin: "http://127.0.0.1:3000" });

    expect(pageInfo().page).toBe(href.slice(0, 2048));
  });
});

describe("currentManifest", () => {
  it("caches the manifest while game, page and embedded stay the same", () => {
    const first = currentManifest(ctx.state, ctx.config);

    expect(currentManifest(ctx.state, ctx.config)).toBe(first);
    expect(ctx.state.manifest).toBe(first);
  });

  it("computes page and embedded at call time and keeps the descriptor lists", () => {
    const first = currentManifest(ctx.state, ctx.config);
    stubPage({
      href: "http://127.0.0.1:3000/game",
      framed: true,
      parentOrigin: "http://127.0.0.1:3000"
    });
    const second = currentManifest(ctx.state, ctx.config);

    expect(second).not.toBe(first);
    expect(second.page).toBe("http://127.0.0.1:3000/game");
    expect(second.embedded).toBe(true);
    expect(second.sources).toBe(first.sources);
    expect(second.commands).toBe(first.commands);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it("follows a document.title change when no name is configured", () => {
    const named = createCtx({ game: game.app });
    buildCatalogue(named);
    vi.stubGlobal("document", { title: "One" });
    const first = currentManifest(named.state, named.config);
    vi.stubGlobal("document", { title: "Two" });

    expect(first.game).toBe("One");
    expect(currentManifest(named.state, named.config).game).toBe("Two");
  });

  it("rebuilds after the cache is dropped", () => {
    const first = currentManifest(ctx.state, ctx.config);
    ctx.state.manifest = undefined;

    expect(currentManifest(ctx.state, ctx.config).commands).not.toBe(first.commands);
  });
});
