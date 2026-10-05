import { describe, expect, expectTypeOf, it } from "vitest";
import type { WorkspaceId } from "../../../workspace/types";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "../../shared/workspaces";

// ─────────────────────────────────────────────────────────────────────────────
// workspaces.ts: the six workspace ids in rail order and their labels, shared
// by workspace (rail, hosts, palette, keys, prefs) and panels (palette items).
// ─────────────────────────────────────────────────────────────────────────────

describe("WORKSPACE_IDS", () => {
  it("lists the six workspaces in rail order, Game first", () => {
    expect(WORKSPACE_IDS).toEqual(["game", "flow", "render", "state", "files", "console"]);
    expectTypeOf(WORKSPACE_IDS).toEqualTypeOf<readonly WorkspaceId[]>();
  });
});

describe("WORKSPACE_LABELS", () => {
  it("labels every workspace", () => {
    expect(WORKSPACE_LABELS).toEqual({
      flow: "Flow",
      game: "Game",
      render: "Render",
      state: "State",
      files: "Files",
      console: "Console"
    });
    expect(WORKSPACE_IDS.map(ws => WORKSPACE_LABELS[ws])).toEqual([
      "Game",
      "Flow",
      "Render",
      "State",
      "Files",
      "Console"
    ]);
  });
});
