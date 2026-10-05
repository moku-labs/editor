import { describe, expect, it } from "vitest";
import * as ids from "../../../workspace/ids";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "../../shared/workspaces";

// ─────────────────────────────────────────────────────────────────────────────
// shared/workspaces.ts: re-exports the workspace ids and labels of
// workspace/ids.ts (their tests live with workspace).
// ─────────────────────────────────────────────────────────────────────────────

describe("shared/workspaces", () => {
  it("re-exports the ids and labels of workspace/ids.ts", () => {
    expect(WORKSPACE_IDS).toBe(ids.WORKSPACE_IDS);
    expect(WORKSPACE_LABELS).toBe(ids.WORKSPACE_LABELS);
  });
});
