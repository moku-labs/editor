import { describe, expect, it } from "vitest";
import { countCores, cpuShare, parseCpuTotal, parseProcStat } from "../../telemetry/cpu";
import { fixture } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C6: CPU per process from /proc/<pid>/stat deltas over /proc/stat.
// ─────────────────────────────────────────────────────────────────────────────

describe("parseProcStat", () => {
  it("reads utime 14, stime 15 and start 22 after the last ')' of a comm with spaces", () => {
    // Bug: fields shifted by a space or a parenthesis in the process name.
    const line =
      "4242 (Chrome_InProcGp (x)) S 1 1 0 0 -1 0 0 0 0 0 731 85 0 0 20 0 9 0 52080 0 0 18446744073709551615";
    expect(parseProcStat(line)).toEqual({
      pid: 4242,
      name: "Chrome_InProcGp (x)",
      utime: 731,
      stime: 85,
      start: 52_080
    });
    expect(parseProcStat("4242 (short) S 1 1")).toBeUndefined();
    expect(parseProcStat("")).toBeUndefined();
  });
});

describe("parseCpuTotal and countCores", () => {
  it("sums user to steal of the cpu line (guest is inside user) and counts the cpuN lines", () => {
    expect(parseCpuTotal("cpu  100 20 50 800 10 0 5 3 70 9")).toBe(988);
    expect(parseCpuTotal("intr 1 2 3")).toBeUndefined();
    expect(countCores(fixture("proc-stat-64.txt"))).toBe(8);
    expect(countCores("cpu  1 2 3")).toBeNull();
  });
});

describe("cpuShare", () => {
  const before = { total: 10_000, ticks: new Map([[23_811, 1730]]) };

  it("gives % of all cores and % of one core over two ticks", () => {
    const after = { total: 10_800, ticks: new Map([[23_811, 1844]]) };
    expect(cpuShare(before, after, 23_811, 8)).toEqual({ pct: 14.3, oneCorePct: 114 });
  });

  it("gives 0 for no change, warming-up on the first tick and when the pid is new", () => {
    const after = { total: 10_800, ticks: new Map([[23_811, 1730]]) };
    expect(cpuShare(before, after, 23_811, 8)).toEqual({ pct: 0, oneCorePct: 0 });
    expect(cpuShare(undefined, after, 23_811, 8)).toBe("warming-up");
    expect(cpuShare({ total: 10_000, ticks: new Map() }, after, 23_811, 8)).toBe("warming-up");
  });

  it("refuses a counter that went down (pid reused) and a tick with no time", () => {
    // Bug: a negative or 900 % CPU.
    const reused = { total: 10_800, ticks: new Map([[23_811, 12]]) };
    expect(cpuShare(before, reused, 23_811, 8)).toBe("error");
    const frozen = { total: 10_000, ticks: new Map([[23_811, 1800]]) };
    expect(cpuShare(before, frozen, 23_811, 8)).toBe("error");
    const unread = { total: 10_800, ticks: new Map<number, number>() };
    expect(cpuShare(before, unread, 23_811, 8)).toBe("unreadable");
  });
});
