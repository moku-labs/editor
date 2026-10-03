import { describe, expect, it } from "vitest";
import { currentStatus, setStatus } from "../../status";
import { createDeps, openDeps } from "../helpers";

describe("currentStatus", () => {
  it("is connecting before start and while connecting", () => {
    const deps = createDeps();
    expect(currentStatus(deps)).toEqual({ kind: "connecting" });
    deps.state.phase = "connecting";
    expect(currentStatus(deps)).toEqual({ kind: "connecting" });
  });

  it("reads the channel heartbeat while open: live or paused", () => {
    const { deps } = openDeps();
    expect(currentStatus(deps)).toEqual({ kind: "live", frame: 12 });
    deps.channel.beat = { frame: 13, paused: true, at: 2 };
    expect(currentStatus(deps)).toEqual({ kind: "paused", frame: 13 });
  });

  it("is the published lost status while lost (a copy)", () => {
    const deps = createDeps();
    const lost = { kind: "lost", reason: "hello 404", lastFrame: 3, retryInMs: 2000 } as const;
    deps.state.phase = "lost";
    deps.state.status = { ...lost };

    const status = currentStatus(deps);

    expect(status).toEqual(lost);
    expect(status).not.toBe(deps.state.status);
  });

  it("is lost with reason stopped after stop", () => {
    const deps = createDeps();
    deps.state.phase = "stopped";
    deps.state.lastFrame = 77;

    expect(currentStatus(deps)).toEqual({
      kind: "lost",
      reason: "stopped",
      lastFrame: 77,
      retryInMs: 0
    });
  });

  it("is never silent or empty", () => {
    const deps = createDeps();
    const kinds = (["idle", "connecting", "open", "lost", "stopped"] as const).map(phase => {
      deps.state.phase = phase;
      return currentStatus(deps).kind;
    });

    expect(kinds).not.toContain("silent");
    expect(kinds).not.toContain("empty");
  });
});

describe("setStatus", () => {
  it("emits on a kind change only; a frame change alone does not emit", () => {
    const deps = createDeps();

    setStatus(deps, { kind: "connecting" });
    setStatus(deps, { kind: "live", frame: 1 });
    setStatus(deps, { kind: "live", frame: 2 });
    setStatus(deps, { kind: "paused", frame: 2 });

    expect(deps.emit.mock.calls).toEqual([
      [{ status: { kind: "live", frame: 1 } }],
      [{ status: { kind: "paused", frame: 2 } }]
    ]);
    expect(deps.state.status).toEqual({ kind: "paused", frame: 2 });
  });

  it("emits with the same kind when the session changed", () => {
    const deps = createDeps();
    deps.state.session = "s-1";

    setStatus(deps, { kind: "connecting" }, true);

    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "connecting" }, session: "s-1" });
  });

  it("omits the session key when there is none", () => {
    const deps = createDeps();

    setStatus(deps, { kind: "live", frame: 1 });

    expect(Object.keys(deps.emit.mock.calls[0]?.[0] ?? {})).toEqual(["status"]);
  });

  it("keeps the latest status even when it does not emit", () => {
    const deps = createDeps();
    deps.state.status = { kind: "lost", reason: "a", lastFrame: 0, retryInMs: 1000 };

    setStatus(deps, { kind: "lost", reason: "b", lastFrame: 0, retryInMs: 2000 });

    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.state.status).toMatchObject({ reason: "b", retryInMs: 2000 });
  });
});
