// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { SOURCE_LOADS } from "../../inspector/files";
import { createTestCtx, jumpCamera, prepare } from "../ctx";

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
