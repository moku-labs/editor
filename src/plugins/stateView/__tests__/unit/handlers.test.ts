import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import type { ToolsEvents } from "../../../../config";
import type { RanEvent } from "../../../workspace/types";
import { createHandlers, onCommandRan, onLinkStatus } from "../../handlers";
import { acceptModel } from "../../tracker";
import { MODEL_AFTER, MODEL_BEFORE } from "../fixtures";
import { createCtx, type TestCtx } from "../helpers";

let ctx: TestCtx;
let calls: number;

const STATE = { path: "board/awaitIntent", frame: 1841, tainted: true };

beforeEach(() => {
  ctx = createCtx();
  calls = 0;
  ctx.state.listeners.add(() => {
    calls += 1;
  });
});

describe("stateView hooks", () => {
  it("hooks link:status and workspace:ran only, typed from the global tools events", () => {
    const hooks = createHandlers(ctx);
    expect(Object.keys(hooks).toSorted()).toEqual(["link:status", "workspace:ran"]);
    expectTypeOf(hooks["link:status"]).parameter(0).toEqualTypeOf<ToolsEvents["link:status"]>();
    expectTypeOf(hooks["workspace:ran"]).parameter(0).toEqualTypeOf<ToolsEvents["workspace:ran"]>();
  });

  it("lost resets the tracker with the note reloaded", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    onLinkStatus(ctx)({
      status: { kind: "lost", reason: "game_reloaded", lastFrame: 1840, retryInMs: 1000 }
    });
    expect(ctx.state.last).toBeUndefined();
    expect(ctx.state.note).toBe("reloaded");
  });

  it("live, paused and silent do nothing", () => {
    acceptModel(ctx, MODEL_BEFORE);
    const handler = createHandlers(ctx)["link:status"];
    handler({ status: { kind: "live", frame: 1841 }, session: "s-1" });
    handler({ status: { kind: "paused", frame: 1841 } });
    handler({ status: { kind: "silent", since: 1, lastFrame: 1841 } });
    expect(ctx.state.baseline).toEqual(MODEL_BEFORE);
    expect(calls).toBe(1);
  });

  it("a settled run takes the taint from its envelope at once", () => {
    const ran: RanEvent = {
      id: "game.step",
      input: { frames: 1 },
      origin: "topbar",
      at: 1,
      ok: true,
      result: { value: { frames: 1 }, state: STATE }
    };
    onCommandRan(ctx)(ran);
    expect(ctx.state.tainted).toBe(true);
    expect(calls).toBe(1);
  });

  it("a failed run is ignored", () => {
    createHandlers(ctx)["workspace:ran"]({
      id: "game.step",
      input: undefined,
      origin: "panel",
      at: 1,
      ok: false,
      error: { code: -32_004, message: "[moku-editor] Command failed." }
    });
    expect(ctx.state.tainted).toBeUndefined();
    expect(calls).toBe(0);
  });
});
