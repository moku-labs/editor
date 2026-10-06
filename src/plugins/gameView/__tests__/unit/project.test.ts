import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDelta, ProjectState } from "../../../registry/protocol";
import { openStyleCard } from "../../element/styles";
import { onProjectChange } from "../../handlers";
import { subscribe } from "../../state";
import type { ElementRef, SpawnAsk, StyleSource, TextureCatalogue } from "../../types";
import { answer, createCtx, flush, place, projectOn, type TestCtx } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The link:project hook (D-46): a new project state drops what gameView
// remembered of the files a batch changed, re-reads a stale manifest, marks a
// broken style card, and looks the selected element up again when touched.
// ─────────────────────────────────────────────────────────────────────────────

const COIN: ElementRef = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
const HUD = 'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n';
const STYLES = "export const coinPill = defineStyle({\n  height: 76\n});\n";
const COIN_STYLE = "style:src/hud/styles.ts#coinPill";
const CATALOGUE: TextureCatalogue = {
  path: "manifest.json",
  textures: new Map(),
  bundles: new Map()
};
const MANIFEST = JSON.stringify({ version: 1, bundles: {} });

let ctx: TestCtx;

/**
 * The path of the catalogue gameView holds (read through a call, so an assignment above does not
 * narrow it).
 *
 * @returns The path, undefined when none is held.
 */
function manifestPath(): string | undefined {
  return ctx.state.manifest?.path;
}

/**
 * A source in a file.
 *
 * @param path - The file.
 * @returns A defined source at line 1.
 */
function sourceIn(path: string): StyleSource {
  return { kind: "defined", path, line: 1, range: [1, 1, 1, 9] };
}

/**
 * A projection answer the index gave in a file.
 *
 * @param path - The file.
 * @returns The ask and its place at line 4.
 */
function spawnIn(path: string): SpawnAsk {
  const at = { path, line: 4 };
  return { asked: Promise.resolve(at), at };
}

/**
 * A delta of a contiguous batch.
 *
 * @param change - The files, moves and removed keys.
 * @returns The delta.
 */
function deltaOf(change: Partial<Omit<ProjectDelta, "all">> = {}): ProjectDelta {
  return { all: false, files: [], moved: [], removed: [], ...change };
}

/**
 * Sends a project state to the hook.
 *
 * @param delta - Its delta.
 * @param state - The state; the ctx's project state by default.
 */
function change(delta: ProjectDelta, state?: ProjectState): void {
  const next = state ?? ctx.link.projectValue ?? projectOn();
  ctx.link.projectValue = next;
  onProjectChange(ctx)({ state: next, delta });
}

beforeEach(() => {
  ctx = createCtx({
    "src/hud/Hud.tsx": HUD,
    "src/hud/styles.ts": STYLES,
    "manifest.json": MANIFEST
  });
  ctx.link.projectValue = projectOn(
    { [COIN_STYLE]: ["src/hud/styles.ts"] },
    { manifest: "manifest.json" }
  );
  answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
  ctx.state.scene = boardScene();
});

describe("link:project: what gameView remembered", () => {
  it("drops every answer, block and projection answer after a gap (all)", () => {
    ctx.state.found.set("hudRow", sourceIn("a.tsx"));
    ctx.state.blocks.set("hudRow", { path: "b.ts", line: 3 });
    ctx.state.spawns.set("board.items", spawnIn("features/board/items.tsx"));
    change({ ...deltaOf(), all: true });
    expect(ctx.state.found.size).toBe(0);
    expect(ctx.state.blocks.size).toBe(0);
    expect(ctx.state.spawns.size).toBe(0);
  });

  it("drops the answers in a changed or moved-from file, of a removed jsx key, and blocks in a changed file", () => {
    ctx.state.found.set("edited", sourceIn("edited.tsx"));
    ctx.state.found.set("moved", sourceIn("old.tsx"));
    ctx.state.found.set("removed", sourceIn("kept-file.tsx"));
    ctx.state.found.set("kept", sourceIn("kept.tsx"));
    ctx.state.blocks.set("edited", { path: "kept-styles.ts", line: 1 });
    ctx.state.blocks.set("kept", { path: "kept-styles.ts", line: 4 });
    ctx.state.blocks.set("styleEdited", { path: "styles.ts", line: 2 });
    ctx.state.spawns.set("board.items", { asked: Promise.resolve(undefined), at: undefined });

    change(
      deltaOf({
        files: ["edited.tsx", "styles.ts"],
        moved: [{ key: "jsx:moved", from: "old.tsx", to: "new.tsx" }],
        removed: ["jsx:removed"]
      })
    );

    expect([...ctx.state.found.keys()]).toEqual(["kept"]);
    expect([...ctx.state.blocks.keys()]).toEqual(["kept"]);
    expect(ctx.state.spawns.size).toBe(0);
  });

  it("drops a projection answer in a changed or moved-from file, of a removed key, or still asked", () => {
    ctx.state.spawns.set("board.items", spawnIn("features/board/items.tsx"));
    ctx.state.spawns.set("board.moved", spawnIn("old.tsx"));
    ctx.state.spawns.set("board.removed", spawnIn("kept-file.tsx"));
    ctx.state.spawns.set("board.asking", { asked: new Promise(() => {}), at: undefined });
    ctx.state.spawns.set("board.kept", spawnIn("kept.tsx"));

    change(
      deltaOf({
        files: ["features/board/items.tsx"],
        moved: [{ key: "projection:board.moved", from: "old.tsx", to: "new.tsx" }],
        removed: ["projection:board.removed"]
      })
    );

    expect([...ctx.state.spawns.keys()]).toEqual(["board.kept"]);
  });

  it("tells the UI", () => {
    const listener = vi.fn();
    subscribe(ctx.state, listener);
    change(deltaOf());
    expect(listener).toHaveBeenCalled();
  });
});

describe("link:project: the manifest", () => {
  it("leaves a manifest that was never read alone", () => {
    const read = vi.spyOn(ctx.link.files, "read");
    change({ ...deltaOf(), all: true });
    expect(ctx.state.manifest).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a read manifest the batch did not touch", () => {
    ctx.state.manifest = CATALOGUE;
    change(deltaOf({ files: ["nodes/merge.ts"] }));
    expect(ctx.state.manifest).toBe(CATALOGUE);
  });

  it("reads it again when it changed on disk, the index names another, or there was none", async () => {
    ctx.state.manifest = CATALOGUE;
    change(deltaOf({ files: ["manifest.json"] }));
    await flush();
    expect(manifestPath()).toBe("manifest.json");
    expect(ctx.state.manifest).not.toBe(CATALOGUE);

    ctx.link.files.put("public/manifest.json", MANIFEST);
    change(deltaOf(), projectOn({}, { manifest: "public/manifest.json", revision: "r2" }));
    await flush();
    expect(manifestPath()).toBe("public/manifest.json");

    // eslint-disable-next-line unicorn/no-null -- null is the "looked, not found" marker
    ctx.state.manifest = null;
    change(deltaOf(), projectOn({}, { manifest: "manifest.json", revision: "r3" }));
    await flush();
    expect(manifestPath()).toBe("manifest.json");
  });

  it("keeps a missing manifest missing while the index still names none", () => {
    // eslint-disable-next-line unicorn/no-null -- null is the "looked, not found" marker
    ctx.state.manifest = null;
    change(deltaOf(), projectOn());
    expect(ctx.state.manifest).toBeNull();
  });
});

describe("link:project: the selected element", () => {
  beforeEach(async () => {
    ctx.state.selected = COIN;
    await openStyleCard(ctx, COIN);
  });

  it("shows the broken text on the card while its file does not parse, and takes it away after", () => {
    const broken = projectOn(
      { [COIN_STYLE]: ["src/hud/styles.ts"] },
      { revision: "r2", broken: { "src/hud/styles.ts": "src/hud/styles.ts:2:3 ',' expected" } }
    );
    change(deltaOf(), broken);
    expect(ctx.state.styles?.error).toEqual({ error: "broken", path: "src/hud/styles.ts" });

    change(deltaOf(), projectOn({ [COIN_STYLE]: ["src/hud/styles.ts"] }, { revision: "r3" }));
    expect(ctx.state.styles?.error).toBeUndefined();
  });

  it("looks the style up again when the key file or the style file changed", async () => {
    ctx.link.files.put("src/hud/styles.ts", `\n${STYLES}`);
    change(deltaOf({ files: ["src/hud/styles.ts"] }));
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "searching" });
    await flush();
    expect(ctx.state.styles?.block.line).toBe(2);
    expect(ctx.state.styles?.current.version).toBe(ctx.link.files.version("src/hud/styles.ts"));
  });

  it("does not look again for an untouched file or during a stepper burst", () => {
    const find = vi.spyOn(ctx.link.files, "find");
    change(deltaOf({ files: ["nodes/merge.ts"] }));
    expect(find).not.toHaveBeenCalled();

    const card = ctx.state.styles;
    if (card === undefined) throw new Error("card");
    card.pending = { path: "height", raw: "76", next: 77 };
    change(deltaOf({ files: ["src/hud/Hud.tsx"] }));
    expect(find).not.toHaveBeenCalled();
    expect(ctx.state.styles).toBe(card);
  });

  it("asks again for a key the index did not know", async () => {
    ctx.link.files.answers.delete("jsx:coinPill");
    await openStyleCard(ctx, COIN);
    expect(ctx.state.lookup).toEqual({ key: "coinPill", status: "missing" });

    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
    change(deltaOf({ files: ["src/hud/Hud.tsx"] }));
    await flush();
    expect(ctx.state.styles?.path).toBe("src/hud/styles.ts");
  });

  it("looks again after a gap even when nothing it read changed", async () => {
    const find = vi.spyOn(ctx.link.files, "find");
    change({ ...deltaOf(), all: true });
    await flush();
    expect(find).toHaveBeenCalledWith("jsx:coinPill");
    expect(ctx.state.styles?.path).toBe("src/hud/styles.ts");
  });

  it("leaves an entity selection alone unless a gap drops everything", () => {
    ctx.state.selected = { kind: "entity", id: 1_048_628 };
    ctx.state.lookup = undefined;
    const find = vi.spyOn(ctx.link.files, "find");
    change(deltaOf({ files: ["src/hud/styles.ts"] }));
    expect(find).not.toHaveBeenCalled();
  });
});
