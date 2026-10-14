/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines and summaries */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdbLoop, stopAdbLoop } from "../../adb/loop";
import { createCollectorApi } from "../../api";
import { createLogSession } from "../../state";
import type { AdbRunner } from "../../types";
import { createCtx, deviceOf, LOG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// sessions() and adb(): fresh copies of the state, never the maps themselves.
// ─────────────────────────────────────────────────────────────────────────────

const ctx = createCtx("/game");

afterEach(() => {
  stopAdbLoop(ctx);
  ctx.state.sessions.clear();
});

describe("sessions", () => {
  it("lists the logs oldest first as copies a caller cannot change the state through", () => {
    const api = createCollectorApi(ctx);
    for (const id of ["d-0001", "d-0002"]) {
      const session = createLogSession({
        device: deviceOf({ id }),
        log: LOG,
        file: `/game/${id}.jsonl`,
        model: "SM-A266B"
      });
      ctx.state.sessions.set(session.key, session);
    }

    const listed = api.sessions();
    Reflect.set(listed[0] ?? {}, "lines", 99);

    expect(listed.map(info => info.file)).toEqual(["/game/d-0001.jsonl", "/game/d-0002.jsonl"]);
    expect(api.sessions()[0]).toEqual({
      device: deviceOf({ id: "d-0001" }),
      log: LOG,
      file: "/game/d-0001.jsonl",
      state: "live",
      lines: 0,
      lost: 0,
      last: null,
      stopTimedOut: false
    });
  });
});

describe("adb", () => {
  it("answers off while device mode is off, else the loop's state and phones", () => {
    const api = createCollectorApi(ctx);
    expect(api.adb()).toEqual({ state: "off", phones: [] });

    const run = vi.fn<AdbRunner>(async () => ({ code: 0, text: "", missing: false }));
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;
    loop.phones.set("R5", {
      serial: "R5",
      model: "SM-A266B",
      reversed: true,
      package: undefined,
      gfx: undefined
    });
    loop.state = "missing";

    expect(api.adb()).toEqual({
      state: "missing",
      phones: [{ serial: "R5", model: "SM-A266B", reversed: true }]
    });
  });
});
