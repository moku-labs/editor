// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { SOURCE_LOADS } from "../../inspector/files";
import { createTestCtx, jumpCamera, type MemoryFiles, prepare } from "../ctx";

const SOURCE = "import { node } from '../kit';\n\nexport const merge = node({});\n";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A context with the merge graph and nodes/merge.ts on disk. */
async function setup() {
  const test = createTestCtx({ files: { "nodes/merge.ts": SOURCE } });
  await prepare(test.ctx);
  await actionsOf(test.ctx).inspector.openCode("board/merge");
  return test;
}

describe("openCode", () => {
  it("reads the node's file and finds its line", async () => {
    const { ctx } = await setup();
    expect(ctx.state.inspector.code).toMatchObject({
      path: "nodes/merge.ts",
      line: 3,
      version: "v1"
    });
    expect(ctx.state.inspector.codeNote).toBeUndefined();
  });

  it("shows the placeholder for a node without a file", async () => {
    const { ctx } = await setup();
    await actionsOf(ctx).inspector.openCode("main/settings");
    expect(ctx.state.inspector.code).toBeUndefined();
    expect(ctx.state.inspector.codeNote).toBe("This node has no file of its own.");
  });

  it("shows 'Source loads from the dev server.' when the read fails", async () => {
    const { ctx, fakes } = await setup();
    fakes.files.failing.set("nodes/merge.ts", new Error("[moku-editor] link closed"));
    await actionsOf(ctx).inspector.openCode("board/merge");
    expect(ctx.state.inspector.codeNote).toBe(SOURCE_LOADS);
  });
});

describe("saveCode", () => {
  it("an identical text is '✓ No changes' and writes nothing", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    await inspector.saveCode();
    expect(fakes.files.writes).toEqual([]);
    expect(ctx.state.inspector.code?.result).toEqual({ ok: true, text: "✓ No changes" });
  });

  it("writes with the version, toasts the file, reloads once with restore (D-07)", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft(`${SOURCE}// edited\n`);
    await inspector.saveCode();
    expect(fakes.files.writes).toEqual([
      { path: "nodes/merge.ts", text: `${SOURCE}// edited\n`, version: "v1" }
    ]);
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Saved", "nodes/merge.ts");
    expect(fakes.reload).toHaveBeenCalledTimes(1);
    expect(fakes.reload).toHaveBeenCalledWith({ restore: true });
    expect(ctx.state.inspector.code?.result).toEqual({
      ok: true,
      text: "✓ Saved · game reloaded · state restored from the last checkpoint"
    });
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
    expect(JSON.stringify(ctx.state.inspector.code)).not.toContain("hot update");
  });

  it("a save the game hot swapped says game updated, without a warn (U10)", async () => {
    const { ctx, fakes } = await setup();
    fakes.reload.mockResolvedValueOnce({ restored: false, reason: "hot_swap" });
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("changed");
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.result).toEqual({ ok: true, text: "✓ Saved · game updated" });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("names the reason when the state was not restored, and warns", async () => {
    const { ctx, fakes } = await setup();
    fakes.reload.mockResolvedValueOnce({ restored: false, reason: "timeout" });
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("changed");
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.result).toEqual({
      ok: false,
      text: "! Saved · game reloaded, state not restored (timeout)"
    });
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("offers Reload file / Save anyway on version_conflict", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("mine");
    fakes.files.store.set("nodes/merge.ts", { text: "theirs", version: "v9" });
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.conflict).toBe(true);
    expect(ctx.state.inspector.code?.result).toEqual({
      ok: false,
      text: "! The file changed on disk"
    });
    await inspector.saveCode(true);
    expect(fakes.files.store.get("nodes/merge.ts")?.text).toBe("mine");
    expect(fakes.files.writes.at(-1)?.version).toBe("v9");
  });

  it("shows a failed write without the [moku-editor] prefix (R7)", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("x");
    vi.mocked(fakes.files.write).mockRejectedValueOnce(
      new Error("[moku-editor] forbidden path: nodes/merge.ts")
    );
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.result).toEqual({
      ok: false,
      text: "! forbidden path: nodes/merge.ts"
    });
  });

  it("reloadCode drops the draft; cancelEdit asks once before discarding", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    expect(inspector.cancelEdit()).toBe(false);
    inspector.edit();
    inspector.setDraft("changed");
    expect(inspector.cancelEdit()).toBe(true);
    expect(ctx.state.inspector.code?.discard).toBe(true);
    expect(ctx.state.inspector.code?.draft).toBe("changed");
    expect(inspector.cancelEdit()).toBe(true);
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
    inspector.edit();
    fakes.files.store.set("nodes/merge.ts", { text: "fresh", version: "v5" });
    await inspector.reloadCode();
    expect(ctx.state.inspector.code).toMatchObject({
      text: "fresh",
      version: "v5",
      draft: undefined
    });
  });
});

/**
 * Holds the answer of every later write until the returned release (a slow dev server).
 *
 * @param files - The in-memory files channel.
 * @returns Lets the held writes answer.
 */
function holdWrites(files: MemoryFiles): () => void {
  const gate = Promise.withResolvers<void>();
  const write = vi.mocked(files.write);
  const original = write.getMockImplementation();
  if (original === undefined) throw new Error("the files channel has no write");
  write.mockImplementation(async (...args: Parameters<typeof original>) => {
    await gate.promise;
    return original(...args);
  });
  return () => gate.resolve();
}

describe("saveCode while a save is in flight", () => {
  const FIRST = `${SOURCE}// first\n`;
  const SECOND = `${FIRST}// typed during the save\n`;

  it("text typed during the save stays the draft; the saved text and version move on", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft(FIRST);
    const release = holdWrites(fakes.files);
    const saving = inspector.saveCode();
    inspector.setDraft(SECOND);
    release();
    await saving;

    expect(fakes.files.writes).toEqual([{ path: "nodes/merge.ts", text: FIRST, version: "v1" }]);
    expect(ctx.state.inspector.code).toMatchObject({
      text: FIRST,
      version: "v2",
      draft: SECOND,
      conflict: false
    });
  });

  it("a save asked during the save runs after it with the new version, no false conflict", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft(FIRST);
    const release = holdWrites(fakes.files);
    const first = inspector.saveCode();
    inspector.setDraft(SECOND);
    const second = inspector.saveCode();
    await Promise.resolve();
    expect(fakes.files.writes).toHaveLength(0);
    release();
    await Promise.all([first, second]);

    expect(fakes.files.writes).toEqual([
      { path: "nodes/merge.ts", text: FIRST, version: "v1" },
      { path: "nodes/merge.ts", text: SECOND, version: "v2" }
    ]);
    expect(fakes.files.store.get("nodes/merge.ts")?.text).toBe(SECOND);
    expect(ctx.state.inspector.code).toMatchObject({ text: SECOND, draft: undefined });
    expect(ctx.state.inspector.code?.conflict).toBe(false);
    expect(fakes.reload).toHaveBeenCalledTimes(2);
  });

  it("a save asked during the save with nothing new typed answers ✓ No changes", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft(FIRST);
    const release = holdWrites(fakes.files);
    const first = inspector.saveCode();
    const second = inspector.saveCode();
    release();
    await Promise.all([first, second]);
    expect(fakes.files.writes).toHaveLength(1);
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
  });

  it("without an open Code tab a save and a file reload do nothing", async () => {
    const { ctx, fakes } = await setup();
    ctx.state.inspector.code = undefined;
    await actionsOf(ctx).inspector.saveCode();
    await actionsOf(ctx).inspector.reloadCode();
    expect(fakes.files.writes).toEqual([]);
    expect(ctx.state.inspector.code).toBeUndefined();
  });
});

describe("saveCode edge results", () => {
  it("a rejection that is not an Error shows its text", async () => {
    const { ctx, fakes } = await setup();
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("x");
    vi.mocked(fakes.files.write).mockRejectedValueOnce("socket gone");
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.result).toEqual({ ok: false, text: "! socket gone" });
  });

  it("a reload that did not restore and gave no reason says unknown", async () => {
    const { ctx, fakes } = await setup();
    fakes.reload.mockResolvedValueOnce({ restored: false });
    const inspector = actionsOf(ctx).inspector;
    inspector.edit();
    inspector.setDraft("changed");
    await inspector.saveCode();
    expect(ctx.state.inspector.code?.result).toEqual({
      ok: false,
      text: "! Saved · game reloaded, state not restored (unknown)"
    });
  });

  it("openCode before the graph arrived leaves the tab alone", async () => {
    const { ctx } = await setup();
    const code = ctx.state.inspector.code;
    ctx.state.data.graph = undefined;
    await actionsOf(ctx).inspector.openCode("board/merge");
    expect(ctx.state.inspector.code).toBe(code);
  });
});

describe("Open in Files and Open in editor", () => {
  it("emits workspace:open-file with the path and line (R4)", async () => {
    const { ctx } = await setup();
    actionsOf(ctx).inspector.openInFiles("nodes/merge.ts", 3);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "nodes/merge.ts",
      line: 3
    });
    actionsOf(ctx).inspector.openInFiles("features/ui/styles.ts");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", { path: "features/ui/styles.ts" });
  });

  it("builds the editor link from link.boot(), none without boot (D-08)", async () => {
    const { ctx, fakes } = await setup();
    expect(actionsOf(ctx).inspector.editorUrl("nodes/merge.ts", 3)).toBe(
      "vscode://file/work/game/nodes/merge.ts:3"
    );
    fakes.boot = undefined;
    expect(actionsOf(ctx).inspector.editorUrl("nodes/merge.ts", 3)).toBeUndefined();
  });

  it("fileOf resolves a node's file and line for the palette", async () => {
    const { ctx } = await setup();
    expect(await actionsOf(ctx).inspector.fileOf("board/merge")).toEqual({
      path: "nodes/merge.ts",
      line: 3
    });
    expect(await actionsOf(ctx).inspector.fileOf("board/catchUp")).toBeUndefined();
  });
});
