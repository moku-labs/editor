// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, createToolsPlugin, toolsCoreConfig } from "../../../../config";
import { panelsPlugin } from "../../../panels";
import { filesViewPlugin } from "../..";
import { createFakeFiles, hashOf } from "../fake-files";
import { createLinkMock, createWorkspaceMock, MANIFEST, PROJECT, SEED } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with a link stub over the in-memory files, a workspace stub,
// the real panels, a probe plugin that hooks workspace:select-node and
// workspace:open-sheet (the global events of src/config.ts, R4), and
// filesView. No flowView, no gameView: start → index → palette → Used by from
// the project index → open → edit → save (toast + reload) → conflict →
// overwrite → chip → contact sheet → workspace:open-file → an agent moves the
// file (link:project) → stop.
// ─────────────────────────────────────────────────────────────────────────────

const files = createFakeFiles({
  ...SEED,
  "features/settings/nodes.ts": "export const enter = 1;\nexport const open = 2;\n"
});
const link = createLinkMock(files);
const workspace = createWorkspaceMock();
const host = document.createElement("section");
const selects: ToolsEvents["workspace:select-node"][] = [];
const sheets: ToolsEvents["workspace:open-sheet"][] = [];

const linkStub = createToolsPlugin("link", { api: () => link.api });
const workspaceStub = createToolsPlugin("workspace", {
  api: () => ({ ...workspace.api, active: () => "files" as const, host: () => host })
});
const probePlugin = createToolsPlugin("probe", {
  hooks: () => ({
    "workspace:select-node": payload => {
      selects.push(payload);
    },
    "workspace:open-sheet": payload => {
      sheets.push(payload);
    }
  })
});

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkStub, workspaceStub, panelsPlugin, probePlugin, filesViewPlugin]
});

/**
 * Waits until the check passes (real time).
 *
 * @param check - The condition.
 * @param label - What is awaited.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

/**
 * A button of the mounted Files panel by its text.
 *
 * @param text - Exact text.
 * @returns The button, or undefined.
 */
function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find(item => item.textContent === text);
}

beforeEach(() => {
  document.body.append(host);
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

describe("filesView integration", () => {
  it("covers createApp → start → api → stop", async () => {
    const added = vi.spyOn(globalThis, "addEventListener");
    const removed = vi.spyOn(globalThis, "removeEventListener");
    const app = framework.createApp({});
    app.log.clearSinks();
    expect(workspace.bindings.map(binding => binding.keys)).toEqual(["mod+s", "\\"]);
    expect(workspace.items.map(item => item.label)).toContain("Show Files tree");
    await app.start();

    // index built, one palette item per file
    await until(() => app.filesView.files().length > 0, "the index");
    const fileItems = workspace.items.filter(item => item.group === "Files");
    expect(fileItems).toHaveLength(app.filesView.files().length);
    expect(added).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    // Used by comes from the project index, with no game; the game brings the graph
    expect(app.filesView.usedBy("features/settings/nodes.ts")).toEqual({
      flows: [],
      nodes: [
        { flow: "settingsPopup", node: "enter" },
        { flow: "settingsPopup", node: "open" }
      ],
      usedIn: ["flows/main.ts"]
    });
    link.attach(MANIFEST);
    await until(() => link.read.mock.calls.length > 0, "the graph");

    // open → edit → save: toast + D-07 reload
    await app.filesView.open("nodes/merge.ts");
    expect(workspace.show).toHaveBeenCalledWith("files");
    app.filesView.edit(true);
    app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
    const saved = await app.filesView.save();
    expect(saved).toMatchObject({ kind: "saved", reload: true });
    expect(workspace.toast).toHaveBeenCalledWith("✓ Saved", "nodes/merge.ts");
    expect(workspace.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: expect.any(Number)
    });

    // the file changes behind the tab → conflict → overwrite
    files.set("nodes/merge.ts", "export const merge = 99;\n");
    app.filesView.setBuffer("nodes/merge.ts", "export const merge = 3;\n");
    const result1 = await app.filesView.save();
    expect(result1.kind).toBe("conflict");
    await until(() => host.querySelector("[data-conflict]") !== null, "the conflict bar");
    const overwritten = await app.filesView.resolveConflict("nodes/merge.ts", "overwrite");
    expect(overwritten).toMatchObject({
      kind: "saved",
      version: hashOf("export const merge = 3;\n")
    });

    // Used-by chip → workspace:select-node, seen by the probe
    await until(() => button("board/merge") !== undefined, "the Used-by chip");
    act(() => {
      button("board/merge")?.click();
    });
    expect(selects).toEqual([{ id: "board/merge" }]);

    // series index → Open contact sheet → workspace:open-sheet
    const series = ".moku/captures/series-2026-09-24-1015/index.json";
    await app.filesView.open(series);
    await until(() => button("Open contact sheet") !== undefined, "the series card");
    act(() => {
      button("Open contact sheet")?.click();
    });
    expect(sheets).toEqual([{ index: series }]);

    // another view asks for a file at a line
    app.emit("workspace:open-file", { path: "flows/board.ts", line: 3 });
    await until(() => app.filesView.active() === "flows/board.ts", "the open-file hook");
    await until(() => app.filesView.tabs().at(-1)?.status === "ready", "the board tab");
    await until(() => host.querySelector("[data-line-current]") !== null, "the current line");
    expect(host.querySelector<HTMLElement>("[data-line-current]")?.dataset.line).toBe("3");

    // an agent moves the board flow: the tab follows in place, Used by reads the new state
    files.contents.delete("flows/board.ts");
    files.set("flows/board/board.ts", SEED["flows/board.ts"] ?? "");
    const moved = {
      ...PROJECT,
      revision: "r2",
      previous: "r1",
      defs: { ...PROJECT.defs, "flow:board": ["flows/board/board.ts"] }
    };
    link.projectValue = moved;
    app.emit("link:project", {
      state: moved,
      delta: {
        all: false,
        files: ["flows/board.ts", "flows/board/board.ts"],
        moved: [{ key: "flow:board", from: "flows/board.ts", to: "flows/board/board.ts" }],
        removed: []
      }
    });
    await until(() => app.filesView.active() === "flows/board/board.ts", "the tab to follow");
    expect(app.filesView.tabs().at(-1)).toMatchObject({ status: "ready", modified: false });
    expect(app.filesView.flowFileOf("board")).toBe("flows/board/board.ts");
    await until(() => host.textContent?.includes("Moved from flows/board.ts") === true, "the note");

    // ⌘S is bound for Files only, while editing
    expect(workspace.bindings[0]?.when?.()).toBe(false);

    await app.stop();
    for (const remover of workspace.keyRemovers) expect(remover).toHaveBeenCalledTimes(1);
    for (const remover of workspace.paletteRemovers) expect(remover).toHaveBeenCalled();
    expect(link.listeners.size).toBe(0);
    expect(removed).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});
