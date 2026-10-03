import { describe, expect, it } from "vitest";
import { badgeOf, pushBadge } from "../../badge";
import { createCtx, entryLine, metaLine } from "../helpers";

const counts = (warn: number, error: number) => ({
  all: 3 + warn + error,
  debug: 1,
  info: 2,
  warn,
  error
});

describe("badgeOf", () => {
  it("is undefined without warnings and errors", () => {
    expect(badgeOf(counts(0, 0))).toBeUndefined();
  });

  it("is amber for warnings only", () => {
    expect(badgeOf(counts(2, 0))).toEqual({ count: 2, tone: "warn", label: "2 warn" });
  });

  it("is red when any error, counting warn + error", () => {
    expect(badgeOf(counts(0, 1))).toEqual({ count: 1, tone: "error", label: "1 error" });
    expect(badgeOf(counts(2, 1))).toEqual({ count: 3, tone: "error", label: "2 warn · 1 error" });
    expect(badgeOf(counts(1, 3))).toEqual({ count: 4, tone: "error", label: "1 warn · 3 error" });
  });
});

describe("pushBadge", () => {
  it("sends the badge of the held lines to workspace", () => {
    const ctx = createCtx();
    ctx.state.lines = [
      entryLine(1, { level: "warn" }),
      metaLine(2),
      entryLine(3, { level: "warn" })
    ];
    pushBadge(ctx);
    expect(ctx.workspace.badge).toHaveBeenLastCalledWith("console", {
      count: 2,
      tone: "warn",
      label: "2 warn"
    });

    ctx.state.lines = [metaLine(4)];
    pushBadge(ctx);
    expect(ctx.workspace.badge).toHaveBeenLastCalledWith("console", undefined);
  });
});
