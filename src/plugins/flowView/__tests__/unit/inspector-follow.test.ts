// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDelta } from "../../../registry/protocol";
import { actionsOf } from "../../actions";
import { createHandlers } from "../../handlers";
import { infoView } from "../../view-model";
import { createTestCtx, flush, jumpCamera, prepare, projectOf, type TestCtx } from "../ctx";

// ─────────────────────────────────────────────────────────────────────────────
// The link:project hook: an agent edits, moves or breaks game files while the
// editor is open. The Code tab follows its node, the Info tab shows the file
// the index names now. The text-styles file is not followed (D-66).
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE = "import { node } from '../kit';\n\nexport const merge = node({});\n";

/** The same node after an agent put three lines above it. */
const EDITED = `// a\n// b\n// c\n${SOURCE}`;

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A delta with only the given fields set.
 *
 * @param change - The fields that differ from "nothing changed".
 * @returns The delta.
 */
function deltaOf(change: Partial<ProjectDelta> = {}): ProjectDelta {
  return { all: false, files: [], moved: [], removed: [], ...change };
}

/**
 * Sends the current fake project state with a delta to the hook, then lets it settle.
 *
 * @param test - The test context.
 * @param change - The delta fields.
 */
async function announce(test: TestCtx, change: Partial<ProjectDelta>): Promise<void> {
  createHandlers(test.ctx)["link:project"]({
    state: projectOf(test.fakes.files),
    delta: deltaOf(change)
  });
  await flush(10);
}

/** A context with the merge graph and the Code tab open on board/merge. */
async function codeOpen(): Promise<TestCtx> {
  const test = createTestCtx({ files: { "nodes/merge.ts": SOURCE } });
  await prepare(test.ctx);
  await actionsOf(test.ctx).inspector.openCode("board/merge");
  test.ctx.state.inspector.tab = "code";
  return test;
}

/** How many times the fake index was asked. */
function finds(test: TestCtx): number {
  return vi.mocked(test.fakes.files.find).mock.calls.length;
}

/** How many files were read. */
function reads(test: TestCtx): number {
  return vi.mocked(test.fakes.files.read).mock.calls.length;
}

describe("link:project and the Code tab", () => {
  it("an edit above the node: the tab takes the new text, version and line", async () => {
    const test = await codeOpen();
    test.fakes.files.store.set("nodes/merge.ts", { text: EDITED, version: "v9" });
    test.fakes.files.index.set("node:board/merge", [{ path: "nodes/merge.ts", line: 6 }]);
    await announce(test, { files: ["nodes/merge.ts"] });
    expect(test.ctx.state.inspector.code).toMatchObject({
      path: "nodes/merge.ts",
      text: EDITED,
      version: "v9",
      line: 6
    });
  });

  it("a move: the tab follows its node to the new file", async () => {
    const test = await codeOpen();
    const { store, index } = test.fakes.files;
    store.delete("nodes/merge.ts");
    store.set("nodes/board/merge.ts", { text: SOURCE, version: "v4" });
    index.set("node:board/merge", [{ path: "nodes/board/merge.ts", line: 3 }]);
    await announce(test, {
      moved: [{ key: "node:board/merge", from: "nodes/merge.ts", to: "nodes/board/merge.ts" }]
    });
    expect(test.ctx.state.inspector.code).toMatchObject({
      path: "nodes/board/merge.ts",
      version: "v4"
    });
  });

  it("a removed file: the tab says the key is no longer in the index", async () => {
    const test = await codeOpen();
    test.fakes.files.store.delete("nodes/merge.ts");
    test.fakes.files.index.delete("node:board/merge");
    await announce(test, { removed: ["nodes/merge.ts"] });
    expect(test.ctx.state.inspector.code).toBeUndefined();
    expect(test.ctx.state.inspector.codeNote).toBe("Not in the project index: node:board/merge");
  });

  it("a draft is never replaced", async () => {
    const test = await codeOpen();
    const inspector = actionsOf(test.ctx).inspector;
    inspector.edit();
    inspector.setDraft("mine");
    const asked = finds(test);
    test.fakes.files.store.set("nodes/merge.ts", { text: EDITED, version: "v9" });
    await announce(test, { files: ["nodes/merge.ts"] });
    expect(finds(test)).toBe(asked);
    expect(test.ctx.state.inspector.code).toMatchObject({ text: SOURCE, draft: "mine" });
  });

  it("a delta that does not touch the file asks nothing", async () => {
    const test = await codeOpen();
    const asked = finds(test);
    await announce(test, { files: ["nodes/toast.ts"], removed: ["nodes/old.ts"] });
    expect(finds(test)).toBe(asked);
  });

  it("off the Code tab nothing is asked; the tab reads the node when shown", async () => {
    const test = await codeOpen();
    test.ctx.state.inspector.tab = "info";
    const asked = finds(test);
    await announce(test, { all: true });
    expect(finds(test)).toBe(asked);
  });

  it("after its own save the result line stays: the version on disk is the saved one", async () => {
    const test = await codeOpen();
    const inspector = actionsOf(test.ctx).inspector;
    inspector.edit();
    inspector.setDraft(EDITED);
    await inspector.saveCode();
    const result = test.ctx.state.inspector.code?.result;
    expect(result?.ok).toBe(true);
    test.fakes.files.index.set("node:board/merge", [{ path: "nodes/merge.ts", line: 6 }]);
    await announce(test, { files: ["nodes/merge.ts"] });
    expect(test.ctx.state.inspector.code).toMatchObject({ text: EDITED, line: 6, result });
  });

  it("a key the index did not know opens once the index learns it", async () => {
    const test = await codeOpen();
    await actionsOf(test.ctx).inspector.openCode("main/settings");
    expect(test.ctx.state.inspector.codeNote).toBe("Not in the project index: node:main/settings");
    test.fakes.files.store.set("flows/main.ts", { text: "a\nsettings\n", version: "m1" });
    test.fakes.files.index.set("node:main/settings", [{ path: "flows/main.ts", line: 2 }]);
    await announce(test, { files: ["flows/main.ts"] });
    expect(test.ctx.state.inspector.code).toMatchObject({ path: "flows/main.ts", line: 2 });
    expect(test.ctx.state.inspector.codeNote).toBeUndefined();
  });

  it("the first state after 'no state yet' (a gap) opens the code", async () => {
    const test = createTestCtx({ files: { "nodes/merge.ts": SOURCE } });
    await prepare(test.ctx);
    test.fakes.files.off = "not opened";
    await actionsOf(test.ctx).inspector.openCode("board/merge");
    test.ctx.state.inspector.tab = "code";
    expect(test.ctx.state.inspector.codeNote).toBe("Project index is off: not opened");
    test.fakes.files.off = undefined;
    await announce(test, { all: true });
    expect(test.ctx.state.inspector.code).toMatchObject({ path: "nodes/merge.ts", line: 3 });
  });
});

describe("link:project and the text-styles file (D-66)", () => {
  const STYLES = "features/ui/styles.ts";

  /** A game file that defines one text style. */
  const DEFINES =
    'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n';

  /** The index of a game with the merge node and one text style. */
  const INDEX = {
    "node:board/merge": [{ path: "nodes/merge.ts", line: 3 }],
    "textStyle:ui.number": [{ path: STYLES, line: 2 }]
  };

  it("a change of the text-styles file reads nothing and adds no palette group", async () => {
    const test = createTestCtx({ files: { [STYLES]: DEFINES }, index: INDEX });
    await announce(test, { files: [STYLES] });
    await announce(test, { all: true });
    await announce(test, {
      moved: [{ key: "textStyle:ui.number", from: STYLES, to: "features/ui/text.ts" }]
    });
    expect(reads(test)).toBe(0);
    expect(finds(test)).toBe(0);
    expect(test.fakes.palette).toEqual([]);
  });

  it("the Code tab stays on a change of the text-styles file, and follows its node's file as before", async () => {
    const test = createTestCtx({
      files: { "nodes/merge.ts": SOURCE, [STYLES]: DEFINES },
      index: INDEX
    });
    await prepare(test.ctx);
    await actionsOf(test.ctx).inspector.openCode("board/merge");
    test.ctx.state.inspector.tab = "code";
    const shown = test.ctx.state.inspector.code;
    const asked = finds(test);
    const read = reads(test);
    const groups = test.fakes.palette.length;

    await announce(test, { files: [STYLES] });
    expect(reads(test)).toBe(read);
    expect(finds(test)).toBe(asked);
    expect(test.fakes.palette.length).toBe(groups);
    expect(test.ctx.state.inspector.code).toBe(shown);

    test.fakes.files.store.set("nodes/merge.ts", { text: EDITED, version: "v9" });
    test.fakes.files.index.set("node:board/merge", [{ path: "nodes/merge.ts", line: 6 }]);
    await announce(test, { files: ["nodes/merge.ts"] });
    expect(test.ctx.state.inspector.code).toMatchObject({ text: EDITED, version: "v9", line: 6 });
  });
});

describe("link:project and the Info tab", () => {
  it("shows the file the index names now, and re-renders", async () => {
    const test = await codeOpen();
    const actions = actionsOf(test.ctx);
    expect(infoView(test.ctx, actions, "board/merge")?.file).toBe("nodes/merge.ts");
    expect(infoView(test.ctx, actions, "board/catchUp")?.file).toBeUndefined();
    test.fakes.files.index.set("node:board/merge", [{ path: "nodes/board/merge.ts", line: 3 }]);
    const revision = test.ctx.state.view.revision;
    await announce(test, { files: ["flows/board.ts"] });
    expect(test.ctx.state.view.revision).toBeGreaterThan(revision);
    expect(infoView(test.ctx, actions, "board/merge")?.file).toBe("nodes/board/merge.ts");
  });
});
