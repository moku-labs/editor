import { describe, expectTypeOf, it } from "vitest";
import type { FrameRange, RenderViewApi } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// spec 09 § M16 "Type-level": what a caller of Mission control's api can get
// wrong is refused by tsc — a span, a rate or a jump kind that does not exist,
// and `shaders` as a Monitoring row of its own (it is part of `passes`). The
// calls live in a function that is type-checked and never run.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls Mission control's api the way the types allow and refuse (never run).
 *
 * @param api - The renderView api.
 */
async function compileOnly(api: RenderViewApi): Promise<void> {
  // @ts-expect-error -- the spans are 6 s, 30 s and 2 min
  api.setSpan(10_000);
  api.setSpan(30_000);
  // @ts-expect-error -- the rate switch pins 60 or 120, or goes adaptive
  await api.setRate(90);
  await api.setRate("adaptive");
  // @ts-expect-error -- shaders is part of the "passes" row
  await api.setSection("shaders", true);
  await api.setSection("nodes", true);
  // @ts-expect-error -- jump goes to a spike group, a GC or a rate change
  api.jump("frame", 1);
  api.jump("gc", -1);
}

describe("RenderViewApi types (spec 09 § M12)", () => {
  it("selects a frame range or clears with undefined, and answers the range kept", () => {
    expectTypeOf<RenderViewApi["select"]>().parameter(0).toEqualTypeOf<FrameRange | undefined>();
    expectTypeOf<RenderViewApi["select"]>().returns.toEqualTypeOf<FrameRange | undefined>();
    expectTypeOf(compileOnly).toBeFunction();
  });
});
