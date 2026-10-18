// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeConnect,
  confirmCode,
  connectSerial,
  listenNetwork,
  openConnect,
  refuseTicket,
  setCode,
  startLocal,
  stopDeviceMode,
  useLocalPreview,
  useSession
} from "../../actions/connect";
import { closePopover, openPopover } from "../../actions/popover";
import { CODE_MISMATCH } from "../../derive/connect";
import { type MissionCtx, missionCtx } from "../mission-ctx";

// ─────────────────────────────────────────────────────────────────────────────
// actions/connect.ts and popover.ts (spec 09 § M3, M7 Connect panel): the
// Connect panel through activeSource.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  ctx = missionCtx();
});

describe("the Connect panel", () => {
  it("opening the panel calls scan() and closing it calls the stop", () => {
    // Bug: a scan lease kept forever (adb polled long after the panel closed).
    openConnect(ctx, undefined);
    openConnect(ctx, "wire");
    expect(ctx.activeSource.api.scan).toHaveBeenCalledTimes(1);
    expect(ctx.state.mission.connect.tab).toBe("wire");
    closeConnect(ctx.state.mission);
    expect(ctx.activeSource.scanStops).toHaveBeenCalledTimes(1);
    expect(ctx.state.mission.popover).toBeUndefined();
  });

  it("one popover at a time: opening another closes the panel and its lease", () => {
    // Bug: two popovers open, or a scan running behind the Monitoring popover.
    openConnect(ctx, "network");
    openPopover(ctx.state.mission, "monitoring");
    expect(ctx.state.mission.popover).toBe("monitoring");
    expect(ctx.activeSource.scanStops).toHaveBeenCalledTimes(1);
    closePopover(ctx.state.mission);
    expect(ctx.state.mission.popover).toBeUndefined();
  });

  it("Connect calls connectDevice(serial) and shows a rejection under the row", async () => {
    // Bug: "No debug game answered" lost: the row just stops spinning.
    vi.mocked(ctx.activeSource.api.connectDevice).mockRejectedValueOnce(
      new Error(
        "[moku-editor] No debug game answered on SM-A266B.\n  Start the debug build on the phone."
      )
    );
    const pending = connectSerial(ctx, "R5CX30ABCDE");
    expect(ctx.state.mission.connect.pending).toBe("R5CX30ABCDE");
    await pending;
    expect(ctx.activeSource.api.connectDevice).toHaveBeenCalledWith("R5CX30ABCDE");
    expect(ctx.state.mission.connect).toMatchObject({
      pending: undefined,
      error: { key: "R5CX30ABCDE", message: "No debug game answered on SM-A266B." }
    });
  });

  it("Link calls confirmPairing(ticket, code) and false shows 'That code does not match'", async () => {
    // Bug: a wrong code accepted silently, or the right code left in the input.
    setCode(ctx.state.mission, "p-3a1f", "4821");
    vi.mocked(ctx.activeSource.api.confirmPairing).mockResolvedValueOnce(false);
    expect(await confirmCode(ctx, "p-3a1f", "4821")).toBe(false);
    expect(ctx.activeSource.api.confirmPairing).toHaveBeenCalledWith("p-3a1f", "4821");
    expect(ctx.state.mission.connect.error).toEqual({ key: "p-3a1f", message: CODE_MISMATCH });
    expect(await confirmCode(ctx, "p-3a1f", "4822")).toBe(true);
    expect(ctx.state.mission.connect.codes.has("p-3a1f")).toBe(false);
  });

  it("Use local preview calls useLocal, not link.choose; Use, Refuse, Listen and Stop call activeSource", async () => {
    // Bug: the phone dropped behind activeSource's back (link.choose leaves it paused and linked).
    await useLocalPreview(ctx);
    expect(ctx.activeSource.api.useLocal).toHaveBeenCalledTimes(1);
    expect(ctx.link.api.choose).not.toHaveBeenCalled();
    await useSession(ctx, "s-9");
    expect(ctx.activeSource.api.useDevice).toHaveBeenCalledWith("s-9");
    await refuseTicket(ctx, "p-3a1f");
    expect(ctx.activeSource.api.refusePairing).toHaveBeenCalledWith("p-3a1f");
    await listenNetwork(ctx);
    expect(ctx.activeSource.api.connectNetwork).toHaveBeenCalledTimes(1);
    await stopDeviceMode(ctx);
    expect(ctx.activeSource.api.stopDevices).toHaveBeenCalledTimes(1);
  });

  it("a refused useLocal or startLocalPreview is toasted with its first line", async () => {
    // Bug: "Start local preview" doing nothing on a page without a game frame.
    vi.mocked(ctx.activeSource.api.useLocal).mockRejectedValueOnce(
      new Error(
        "[moku-editor] activeSource.useLocal: this page has no local preview.\n  Open the editor with a game."
      )
    );
    await useLocalPreview(ctx);
    expect(ctx.workspace.toast).toHaveBeenLastCalledWith(
      "activeSource.useLocal: this page has no local preview."
    );
    ctx.workspace.startLocalPreview.mockRejectedValueOnce(
      new Error(
        "[moku-editor] workspace.startLocalPreview() needs a game frame.\n  This page shows a device only."
      )
    );
    await startLocal(ctx);
    expect(ctx.workspace.toast).toHaveBeenLastCalledWith(
      "workspace.startLocalPreview() needs a game frame."
    );
  });
});
