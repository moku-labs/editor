import { describe, expect, it } from "vitest";
import type { Json, ProjectState } from "../../../registry/protocol";
import { errorCode, wireError } from "../../../registry/protocol";
import { flowStartOf, loadGraph, usedByOf } from "../../links/used-by";
import { createCtx, MANIFEST, PROJECT } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Used by from the project index: the flows and nodes a file defines (`flow:`
// and `node:` defs, any file name), the files that use what it defines, the
// off index; flowStartOf and loadGraph (the start node of a flow chip).
// ─────────────────────────────────────────────────────────────────────────────

/** The merge-game index, as far as Used by reads it: a moved node and a conflict. */
const MERGE: ProjectState = {
  state: "on",
  revision: "r7",
  defs: {
    "flow:main": ["flows/main.ts"],
    "flow:board": ["flows/board.ts"],
    "flow:settingsPopup": ["features/settings/flow.ts"],
    "node:board/merge": ["nodes/merge.ts"],
    "node:board/catchUp": ["nodes/board/catch-up.ts"],
    "node:settingsPopup/open": ["features/settings/nodes.ts"],
    "node:settingsPopup/confirm": ["features/settings/nodes.ts"],
    "node:main/home": ["nodes/home.ts", "nodes/home-copy.ts"],
    "style:features/settings/nodes.ts#panel": ["features/settings/nodes.ts"],
    "textStyle:ui.number": ["features/ui/text-styles.ts"]
  },
  uses: {
    "node:board/merge": ["flows/board.ts"],
    "node:board/catchUp": ["flows/board.ts"],
    "node:settingsPopup/open": ["features/settings/flow.ts"],
    "style:features/settings/nodes.ts#panel": [
      "features/settings/popup.tsx",
      "features/settings/nodes.ts"
    ]
  },
  broken: {}
};

/** A small game.graph with a start node per flow. */
const GRAPH: Json = {
  main: "main",
  flows: { board: { start: "awaitIntent", nodes: {}, edges: {} }, odd: { start: 3 } }
};

describe("usedByOf", () => {
  it("lists the nodes a non-kebab file defines and the files that use them", () => {
    expect(usedByOf(MERGE, "features/settings/nodes.ts")).toEqual({
      flows: [],
      nodes: [
        { flow: "settingsPopup", node: "open" },
        { flow: "settingsPopup", node: "confirm" }
      ],
      usedIn: ["features/settings/flow.ts", "features/settings/popup.tsx"]
    });
  });

  it("follows a node to the file it moved to", () => {
    expect(usedByOf(MERGE, "nodes/board/catch-up.ts")).toEqual({
      flows: [],
      nodes: [{ flow: "board", node: "catchUp" }],
      usedIn: ["flows/board.ts"]
    });
    expect(usedByOf(MERGE, "nodes/catch-up.ts")).toEqual({ flows: [], nodes: [], usedIn: [] });
  });

  it("lists a flow in its file and both files of a conflict", () => {
    expect(usedByOf(MERGE, "flows/board.ts")).toEqual({ flows: ["board"], nodes: [], usedIn: [] });
    expect(usedByOf(MERGE, "nodes/home-copy.ts").nodes).toEqual([{ flow: "main", node: "home" }]);
    expect(usedByOf(MERGE, "nodes/home.ts").nodes).toEqual([{ flow: "main", node: "home" }]);
  });

  it("gives a file with no flow or node only its users", () => {
    expect(usedByOf(MERGE, "features/ui/text-styles.ts")).toEqual({
      flows: [],
      nodes: [],
      usedIn: []
    });
  });

  it("is empty while the index is off or before its first state", () => {
    const empty = { flows: [], nodes: [], usedIn: [] };
    expect(
      usedByOf({ state: "off", reason: "typescript is not installed" }, "nodes/merge.ts")
    ).toEqual(empty);
    expect(usedByOf(undefined, "nodes/merge.ts")).toEqual(empty);
  });

  it("skips a node key without a flow", () => {
    const odd: ProjectState = { ...MERGE, defs: { "node:lonely": ["nodes/lonely.ts"] }, uses: {} };
    expect(usedByOf(odd, "nodes/lonely.ts").nodes).toEqual([]);
  });
});

describe("flowStartOf", () => {
  it("reads a flow's start", () => {
    expect(flowStartOf(GRAPH, "board")).toBe("awaitIntent");
    expect(flowStartOf(GRAPH, "nope")).toBeUndefined();
    expect(flowStartOf(GRAPH, "odd")).toBeUndefined();
    expect(flowStartOf(undefined, "board")).toBeUndefined();
    expect(flowStartOf("graph", "board")).toBeUndefined();
  });
});

describe("loadGraph", () => {
  it("reads game.graph while a manifest is present and notifies", async () => {
    const ctx = createCtx();
    let heard = 0;
    ctx.state.listeners.add(() => {
      heard += 1;
    });
    ctx.link.manifestValue = MANIFEST;
    await loadGraph(ctx);
    expect(ctx.link.read).toHaveBeenCalledWith("game.graph");
    expect(ctx.state.graph).toEqual(ctx.link.graph);
    expect(heard).toBe(1);
  });

  it("clears the graph without a manifest", async () => {
    const ctx = createCtx();
    ctx.state.graph = { main: "x" };
    await loadGraph(ctx);
    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.state.graph).toBeUndefined();
  });

  it("logs a failed read and clears the graph", async () => {
    const ctx = createCtx();
    ctx.link.manifestValue = MANIFEST;
    ctx.link.graph = undefined;
    await loadGraph(ctx);
    expect(ctx.state.graph).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:graph-failed", {
      message: "no value for game.graph"
    });
  });

  it("logs a read lost to a page reload at debug: the next manifest reads again", async () => {
    const ctx = createCtx();
    ctx.link.manifestValue = MANIFEST;
    ctx.link.read.mockRejectedValueOnce(
      wireError(errorCode.gameReloaded, "game reloaded", {
        reason: "game_reloaded",
        retryable: true
      })
    );
    await loadGraph(ctx);
    expect(ctx.state.graph).toBeUndefined();
    expect(ctx.log.debug).toHaveBeenCalledWith("filesView:graph-failed", {
      message: "game reloaded"
    });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("logs a read whose session closed meanwhile at debug", async () => {
    const ctx = createCtx();
    ctx.link.manifestValue = MANIFEST;
    ctx.link.read.mockRejectedValueOnce(
      wireError(errorCode.noSession, "No game is connected.", {
        reason: "no_session",
        retryable: false
      })
    );
    await loadGraph(ctx);
    expect(ctx.log.debug).toHaveBeenCalledWith("filesView:graph-failed", {
      message: "No game is connected."
    });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("does not need the index for Used by", () => {
    expect(usedByOf(PROJECT, "nodes/merge.ts").nodes).toEqual([{ flow: "board", node: "merge" }]);
  });
});
