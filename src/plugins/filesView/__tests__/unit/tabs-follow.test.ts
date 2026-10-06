import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectDelta, ProjectMove } from "../../../registry/protocol";
import { onLinkProject } from "../../handlers";
import { MISSING_MESSAGE } from "../../tabs/load";
import { findTab } from "../../tabs/model";
import { openTab } from "../../tabs/open";
import { buildIndex } from "../../tree/walk";
import { hashOf } from "../fake-files";
import { createCtx, PROJECT, SEED, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Open tabs follow the project index (`link:project`): a moved file's tab is
// replaced in place by the new path with the line of its key, a clean tab takes
// the new text, a modified one goes to conflict; an edit by an agent refreshes
// a tab at once; a gone file shows missing; a new or gone path rebuilds the
// tree. Deltas apply one after the other.
// ─────────────────────────────────────────────────────────────────────────────

const FROM = "nodes/catch-up.ts";
const TO = "nodes/board/catch-up.ts";
const TEXT = "export const catchUp = defineNode({});\n";
const MOVE: ProjectMove = { key: "node:board/catchUp", from: FROM, to: TO };

let ctx: TestCtx;

beforeEach(async () => {
  ctx = createCtx({ seed: { ...SEED, [FROM]: TEXT } });
  await buildIndex(ctx);
});

/**
 * A delta of one batch.
 *
 * @param change - The lists that differ from an empty batch.
 * @returns The delta.
 */
function deltaOf(change: Partial<ProjectDelta>): ProjectDelta {
  return { all: false, files: [], moved: [], removed: [], ...change };
}

/**
 * Sends a `link:project` and waits until its delta is applied.
 *
 * @param delta - The delta.
 */
async function follow(delta: ProjectDelta): Promise<void> {
  onLinkProject(ctx)({ state: PROJECT, delta });
  await ctx.state.following;
}

/**
 * Moves a file in the fake files, like an agent's `git mv`.
 *
 * @param text - The text at the new path; the old text when omitted.
 */
function moveFile(text?: string): void {
  const old = ctx.files.contents.get(FROM) ?? "";
  ctx.files.contents.delete(FROM);
  ctx.files.set(TO, text ?? old);
  ctx.files.found.set(MOVE.key, [
    { path: TO, binding: "catchUp", line: 9, range: [9, 1, 12, 3], hash: hashOf(text ?? old) }
  ]);
}

/** The delta of the move. */
const MOVED = deltaOf({ files: ["flows/board.ts", TO, FROM], moved: [MOVE] });

describe("a moved file", () => {
  it("replaces a clean tab in place: path, line, message, active, edit mode", async () => {
    await openTab(ctx, "flows/main.ts", {});
    await openTab(ctx, FROM, { edit: true, line: 2 });
    await openTab(ctx, "README.md", {});
    await openTab(ctx, FROM, {});
    moveFile();

    await follow(MOVED);

    expect(ctx.state.tabs.map(tab => tab.path)).toEqual(["flows/main.ts", TO, "README.md"]);
    expect(ctx.state.active).toBe(TO);
    expect(findTab(ctx.state, TO)).toMatchObject({
      status: "ready",
      saved: TEXT,
      buffer: TEXT,
      version: hashOf(TEXT),
      editing: true,
      mode: "source",
      line: 9,
      message: "Moved from nodes/catch-up.ts"
    });
    expect(ctx.state.expanded.has("nodes/board")).toBe(true);
  });

  it("a clean tab takes the new text when the file changed in the move", async () => {
    await openTab(ctx, FROM, {});
    moveFile("export const catchUp = defineNode({ fast: true });\n");

    await follow(MOVED);

    expect(findTab(ctx.state, TO)).toMatchObject({
      status: "ready",
      saved: "export const catchUp = defineNode({ fast: true });\n",
      message: "Moved from nodes/catch-up.ts"
    });
  });

  it("a modified tab follows with its buffer; the same bytes keep it ready", async () => {
    await openTab(ctx, FROM, { edit: true });
    const tab = findTab(ctx.state, FROM);
    if (tab) tab.buffer = "my edit";
    moveFile();

    await follow(MOVED);

    expect(findTab(ctx.state, TO)).toMatchObject({
      status: "ready",
      saved: TEXT,
      buffer: "my edit",
      editing: true
    });
  });

  it("a modified tab follows then shows the conflict when the bytes changed", async () => {
    await openTab(ctx, FROM, { edit: true });
    const tab = findTab(ctx.state, FROM);
    if (tab) tab.buffer = "my edit";
    moveFile("their edit\n");

    await follow(MOVED);

    expect(findTab(ctx.state, TO)).toMatchObject({
      status: "conflict",
      saved: TEXT,
      buffer: "my edit",
      message: "Moved from nodes/catch-up.ts"
    });
  });

  it("keeps the line when find fails, and the discard popover follows", async () => {
    await openTab(ctx, FROM, { line: 4 });
    ctx.state.confirmClose = FROM;
    moveFile();
    ctx.files.failures.set(`find:${MOVE.key}`, new Error("[moku-editor] link closed"));

    await follow(MOVED);

    expect(findTab(ctx.state, TO)?.line).toBe(4);
    expect(ctx.state.confirmClose).toBe(TO);
  });

  it("takes the line only from an answer at the new path", async () => {
    await openTab(ctx, FROM, { line: 4 });
    moveFile();
    ctx.files.found.set(MOVE.key, [
      { path: "nodes/elsewhere.ts", binding: "catchUp", line: 30, range: [30, 1, 31, 3], hash: "x" }
    ]);

    await follow(MOVED);

    expect(findTab(ctx.state, TO)?.line).toBe(4);
  });

  it("rebuilds the tree once more when a delta comes during a walk", async () => {
    const nodes = ctx.files.hold("nodes");
    const walking = buildIndex(ctx);
    // The walk listed the root and waits on the next level when an agent adds a root file.
    await nodes.reached;
    ctx.files.set("fresh.ts", "export const fresh = 1;\n");

    await follow(deltaOf({ files: ["fresh.ts"] }));
    nodes.release();
    await walking;

    expect(ctx.state.index?.files.has("fresh.ts")).toBe(true);
  });

  it("does not follow a key that left a file still on disk", async () => {
    await openTab(ctx, FROM, {});
    ctx.files.set(TO, "export const catchUp = 2;\n");

    await follow(MOVED);

    expect(ctx.state.tabs.map(tab => tab.path)).toEqual([FROM]);
    expect(findTab(ctx.state, FROM)?.status).toBe("ready");
  });

  it("does not follow onto a path that already has a tab: the old tab shows missing", async () => {
    await openTab(ctx, FROM, {});
    ctx.files.set(TO, TEXT);
    await openTab(ctx, TO, {});
    moveFile();

    await follow(MOVED);

    expect(ctx.state.tabs.map(tab => tab.path)).toEqual([FROM, TO]);
    expect(findTab(ctx.state, FROM)).toMatchObject({ status: "missing", message: MISSING_MESSAGE });
  });

  it("shows the read failure of the new path", async () => {
    await openTab(ctx, FROM, {});
    moveFile();
    ctx.files.failures.set(`read:${TO}`, new Error("[moku-editor] link closed"));

    await follow(MOVED);

    expect(findTab(ctx.state, TO)).toMatchObject({ status: "error", message: "link closed" });
  });

  it("rebuilds the file tree", async () => {
    moveFile();

    await follow(MOVED);
    await ctx.state.indexing;

    expect(ctx.state.index?.files.has(TO)).toBe(true);
    expect(ctx.state.index?.files.has(FROM)).toBe(false);
  });
});

describe("an edit by an agent", () => {
  it("refreshes a clean tab at once, without waiting revalidateMs", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.files.set("nodes/merge.ts", "export const merge = 2;\n");

    await follow(deltaOf({ files: ["nodes/merge.ts"] }));

    expect(findTab(ctx.state, "nodes/merge.ts")?.saved).toBe("export const merge = 2;\n");
    expect(ctx.state.indexing).toBeUndefined();
  });

  it("leaves tabs of other files unread", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.files.client.read.mockClear();

    await follow(deltaOf({ files: ["flows/board.ts"] }));

    expect(ctx.files.client.read).not.toHaveBeenCalled();
  });

  it("re-reads every tab after a revision gap", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    await openTab(ctx, "flows/main.ts", {});
    ctx.files.set("nodes/merge.ts", "a\n");
    ctx.files.set("flows/main.ts", "b\n");

    await follow({ all: true, files: [], moved: [], removed: [] });

    expect(ctx.state.tabs.map(tab => tab.saved)).toEqual(["a\n", "b\n"]);
  });

  it("marks a removed file missing and rebuilds the tree", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.files.contents.delete("nodes/merge.ts");

    await follow(deltaOf({ files: ["nodes/merge.ts"], removed: ["node:board/merge"] }));
    await ctx.state.indexing;

    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "missing",
      message: MISSING_MESSAGE
    });
    expect(ctx.state.index?.files.has("nodes/merge.ts")).toBe(false);
  });

  it("brings a missing tab back when its file returns", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.files.contents.delete("nodes/merge.ts");
    await follow(deltaOf({ files: ["nodes/merge.ts"] }));
    await ctx.state.indexing;
    ctx.files.set("nodes/merge.ts", "export const merge = 1;\n");

    await follow(deltaOf({ files: ["nodes/merge.ts"] }));

    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "ready",
      message: undefined
    });
  });

  it("rebuilds the tree for a new path", async () => {
    ctx.files.set("nodes/new.ts", "export const fresh = 1;\n");

    await follow(deltaOf({ files: ["nodes/new.ts"] }));
    await ctx.state.indexing;

    expect(ctx.state.index?.files.has("nodes/new.ts")).toBe(true);
  });

  it("applies deltas one after the other and notifies", async () => {
    await openTab(ctx, "nodes/merge.ts", {});
    let heard = 0;
    ctx.state.listeners.add(() => {
      heard += 1;
    });
    ctx.files.set("nodes/merge.ts", "one\n");
    onLinkProject(ctx)({ state: PROJECT, delta: deltaOf({ files: ["nodes/merge.ts"] }) });
    const first = ctx.state.following;
    onLinkProject(ctx)({ state: PROJECT, delta: deltaOf({ files: ["nodes/merge.ts"] }) });
    await first;
    await ctx.state.following;

    expect(ctx.state.following).toBeUndefined();
    expect(findTab(ctx.state, "nodes/merge.ts")?.saved).toBe("one\n");
    expect(heard).toBeGreaterThan(1);
  });
});
