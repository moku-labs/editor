import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import { filesPlugin } from "../../../files";
import { createPagesApi } from "../../api";
import { createPagesHooks } from "../../handlers";
import { sessionEvent } from "../../perf/__tests__/helpers";
import { createPagesState } from "../../state";
import type { PagesCtx } from "../../types";
import { createFiles, createHub, createLog, DEFAULT_CONFIG } from "../helpers";

/** The absolute file of the fixture log under the root /game. */
const FILE = "/game/.moku/perf/perf-20261014-1532-sm-a266b.jsonl";

/**
 * A pages ctx over a files api rooted at /game whose engine id is given.
 *
 * @param engineId - What files.engine().id answers.
 * @returns The ctx and a recording output.
 */
function createCtx(engineId: string) {
  const files = {
    ...createFiles("/game"),
    engine: () => ({ id: engineId, version: "0.14.12", dist: "9c41e0" })
  };
  const hub = createHub();
  const require = (plugin: unknown) => (plugin === filesPlugin ? files : hub);
  const ctx: PagesCtx = {
    config: DEFAULT_CONFIG,
    state: createPagesState({ config: DEFAULT_CONFIG }),
    log: createLog(),
    require: require as unknown as Require
  };
  const output = {
    line: vi.fn<(text?: string) => void>(),
    warn: vi.fn<(message: string) => void>()
  };
  return { ctx, output };
}

describe("collector:session hook", () => {
  it("does nothing before attachPerf (every app that is not a perf run)", () => {
    const { ctx } = createCtx("0.14.12+9c41e0");
    expect(() =>
      createPagesHooks(ctx)["collector:session"](sessionEvent({ file: FILE }))
    ).not.toThrow();
    expect(ctx.state.perf).toBeUndefined();
  });

  it("prints the live lines after attachPerf, the file relative to the root", () => {
    const { ctx, output } = createCtx("0.14.12+9c41e0");
    createPagesApi(ctx).attachPerf(output);
    createPagesHooks(ctx)["collector:session"](sessionEvent({ file: FILE }));
    expect(output.line.mock.calls.map(([text]) => text)).toEqual([
      "◉ SM-A266B · webgpu · engine 0.14.12+9c41e0 · build debug-20261014T160000Z · adb 127.0.0.1",
      "  ● REC → .moku/perf/perf-20261014-1532-sm-a266b.jsonl",
      "  garden/boss  @60  54 fps  p90 18.2  gpu 6.1  spikes 2 (upload, gc?)  38.0 °C  · 1 840 lines"
    ]);
    expect(output.warn).not.toHaveBeenCalled();
  });

  it("warns STALE through output.warn against files.engine().id", () => {
    const { ctx, output } = createCtx("0.14.13+1ab7f2");
    createPagesApi(ctx).attachPerf(output);
    createPagesHooks(ctx)["collector:session"](sessionEvent({ file: FILE }));
    expect(output.warn).toHaveBeenCalledWith(
      "STALE: SM-A266B runs engine 0.14.12+9c41e0, this computer has 0.14.13+1ab7f2 · rebuild the game so the logs match"
    );
    expect(output.line.mock.calls.some(([text]) => text?.startsWith("STALE"))).toBe(false);
  });
});
