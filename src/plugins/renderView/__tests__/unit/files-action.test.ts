// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupFiles, openFile, systemFile } from "../../actions/files";
import { type MissionCtx, missionCtx } from "../mission-ctx";

// ─────────────────────────────────────────────────────────────────────────────
// actions/files.ts (spec 09 § M10 Files): system:<name> looked up once per
// session, and the open-file emission.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  ctx = missionCtx();
  vi.mocked(ctx.link.api.files.find).mockImplementation((key: string) =>
    Promise.resolve(
      key === "system:ward.update"
        ? [
            {
              path: "src/systems/ward.ts",
              binding: "ward",
              line: 12,
              range: [12, 1, 40, 2] as const,
              hash: "a1"
            }
          ]
        : []
    )
  );
});

describe("file links", () => {
  it("a system name is looked up once per session; an engine system answers null", async () => {
    // Bug: a project-index request per inspector render.
    expect(await systemFile(ctx, "ward.update")).toEqual({ path: "src/systems/ward.ts", line: 12 });
    expect(await systemFile(ctx, "ward.update")).toEqual({ path: "src/systems/ward.ts", line: 12 });
    expect(await systemFile(ctx, "engine.render")).toBeNull();
    await lookupFiles(ctx, ["ward.update", "engine.render", "fog.render"]);
    expect(ctx.link.api.files.find).toHaveBeenCalledTimes(3);
    vi.mocked(ctx.link.api.files.find).mockRejectedValueOnce(
      new Error("[moku-editor] not installed")
    );
    expect(await systemFile(ctx, "hud.update")).toBeNull();
  });

  it("a file click emits workspace:open-file with path and line and toasts 'Open in editor: …'", () => {
    // Bug: a file link that opens nothing (no emission) or opens without a line.
    openFile(ctx, "src/systems/ward.ts", 12);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/systems/ward.ts",
      line: 12
    });
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Open in editor: src/systems/ward.ts:12");
  });
});
