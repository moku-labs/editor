// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDelta } from "../../../registry/protocol";
import { actionsOf } from "../../actions";
import { createHandlers } from "../../handlers";
import { infoView } from "../../view-model";
import { createTestCtx, flush, jumpCamera, prepare, projectOf, type TestCtx } from "../ctx";
import { fixtureText } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The link:project hook: an agent edits, moves or breaks game files while the
// editor is open. The Code tab follows its node, the Styles group re-reads the
// text styles, the Info tab shows the file the index names now.
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

/** The labels of the last palette group added. */
function styleItems(test: TestCtx): string[] {
  return (test.fakes.palette.at(-1) ?? []).map(item => item.label);
}

describe("link:project and the text styles", () => {
  const STYLES = "features/ui/styles.ts";

  it("a change of the text-styles file re-reads the Styles group; other changes do not", async () => {
    const test = createTestCtx({ files: { [STYLES]: fixtureText("ui-styles.txt") } });
    await actionsOf(test.ctx).inspector.readStyleKeys();
    const groups = test.fakes.palette.length;
    expect(styleItems(test)).toContain("ui.number");

    await announce(test, { files: ["nodes/merge.ts"] });
    expect(test.fakes.palette.length).toBe(groups);

    await announce(test, { files: [STYLES] });
    expect(test.fakes.palette.length).toBe(groups + 1);

    await announce(test, {
      moved: [{ key: "textStyle:ui.number", from: STYLES, to: "features/ui/text.ts" }]
    });
    expect(test.fakes.palette.length).toBe(groups + 2);
  });

  it("a new text-styles file in the index re-reads the group from it", async () => {
    const test = createTestCtx({
      files: {
        [STYLES]: fixtureText("ui-styles.txt"),
        "game/text.ts":
          'export const textStyles = defineTextStyles({\n  "hud.coins": { size: 40 }\n});\n'
      }
    });
    await actionsOf(test.ctx).inspector.readStyleKeys();
    const { index } = test.fakes.files;
    index.delete("textStyle:ui.title");
    index.delete("textStyle:ui.number");
    index.set("textStyle:hud.coins", [{ path: "game/text.ts", line: 2 }]);
    await announce(test, { files: ["game/text.ts"] });
    expect(styleItems(test)).toEqual(["hud.coins"]);
  });
});

describe("link:project and the Styles tab", () => {
  const STYLES = "features/ui/styles.ts";
  const FIXTURE = fixtureText("ui-styles.txt");

  /** The fixture after an agent changed the size of ui.number to 62. */
  const AGENT_EDIT = FIXTURE.replace(
    '"ui.number": {\n    font: "ui.font-display",\n    size: 60',
    '"ui.number": {\n    font: "ui.font-display",\n    size: 62'
  );

  /** A game file that defines one text style. */
  const DEFINES =
    'export const textStyles = defineTextStyles({\n  "hud.coins": { size: 40 }\n});\n';

  it("a Styles tab opened before the first project state reads the styles when it arrives", async () => {
    const test = createTestCtx({ files: { [STYLES]: FIXTURE } });
    test.fakes.project = undefined;
    await actionsOf(test.ctx).inspector.openStyles();
    expect(test.ctx.state.inspector.styles).toMatchObject({ file: undefined, blocks: [] });

    test.fakes.project = "index";
    await announce(test, { all: true });
    const styles = test.ctx.state.inspector.styles;
    expect(styles?.file).toBe(STYLES);
    expect(styles?.blocks.length).toBeGreaterThan(10);
    expect(styles?.error).toBeUndefined();
    expect(styleItems(test)).toContain("ui.number");
  });

  it("a tab that said the index has no text styles reads them once the index learns them", async () => {
    const test = createTestCtx({ files: { "game/text.ts": DEFINES }, index: {} });
    await actionsOf(test.ctx).inspector.openStyles();
    expect(test.ctx.state.inspector.styles?.file).toBeUndefined();

    test.fakes.files.index.set("textStyle:hud.coins", [{ path: "game/text.ts", line: 2 }]);
    await announce(test, { files: ["game/text.ts"] });
    expect(test.ctx.state.inspector.styles?.file).toBe("game/text.ts");
    expect(test.ctx.state.inspector.styles?.blocks.map(block => block.ref)).toEqual([
      { kind: "text", key: "hud.coins" }
    ]);
  });

  it("an agent's edit of the styles file re-reads the tab and keeps the chosen card", async () => {
    const test = createTestCtx({ files: { [STYLES]: FIXTURE } });
    await actionsOf(test.ctx).inspector.openStyles("ui.number");
    test.fakes.files.store.set(STYLES, { text: AGENT_EDIT, version: "v9" });
    await announce(test, { files: [STYLES] });
    expect(test.ctx.state.inspector.styles).toMatchObject({
      file: STYLES,
      text: AGENT_EDIT,
      version: "v9",
      key: "ui.number"
    });
  });

  it("a change elsewhere does not read the tab again", async () => {
    const test = createTestCtx({ files: { [STYLES]: FIXTURE } });
    await actionsOf(test.ctx).inspector.openStyles("ui.number");
    const reads = vi.mocked(test.fakes.files.read).mock.calls.length;
    await announce(test, { files: ["nodes/merge.ts"] });
    expect(vi.mocked(test.fakes.files.read).mock.calls.length).toBe(reads);
  });

  it("after its own write the result line stays: the file on disk is the written version", async () => {
    const test = createTestCtx({ files: { [STYLES]: FIXTURE }, config: { styleSaveDelayMs: 0 } });
    const inspector = actionsOf(test.ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    await flush(10);
    const written = test.ctx.state.inspector.styles;
    expect(written?.result?.text).toBe(
      "✓ Written to features/ui/styles.ts:74 · game reloaded · state restored"
    );

    await announce(test, { files: [STYLES] });
    expect(test.ctx.state.inspector.styles).toBe(written);
    expect(test.ctx.state.inspector.styles?.result).toEqual(written?.result);
  });

  it("a stepper burst waiting for its write is never re-read", async () => {
    const test = createTestCtx({ files: { [STYLES]: FIXTURE } });
    const inspector = actionsOf(test.ctx).inspector;
    await inspector.openStyles("ui.number");
    inspector.stepStyle("size", 1, false);
    test.fakes.files.store.set(STYLES, { text: AGENT_EDIT, version: "v9" });
    await announce(test, { files: [STYLES] });
    const styles = test.ctx.state.inspector.styles;
    expect(styles).toMatchObject({ version: "v1", text: FIXTURE });
    expect(styles?.pending?.next).toBe(61);
    clearTimeout(styles?.pending?.timer);
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
