import { afterEach, describe, expect, it, vi } from "vitest";
import { runAdb } from "../../adb/run";
import type { AdbResult } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// runAdb, the one process seam: what a missing command and a hung one answer.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

describe("runAdb", () => {
  it("answers the exit code and the standard output", async () => {
    expect(await runAdb("sh", ["-c", "echo SM-A266B; exit 3"], 5000)).toEqual({
      code: 3,
      text: "SM-A266B\n",
      missing: false
    });
  });

  it("answers missing for a command that cannot be spawned (bug: a USB-less computer crashing the loop)", async () => {
    expect(await runAdb("moku-no-such-adb-command", ["devices"], 5000)).toEqual({
      code: 127,
      text: "",
      missing: true
    });
  });

  it("kills a command that outlives the timeout and answers code -1 without text (bug: a hung adb blocking every round)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answered: AdbResult | undefined;
    const running = runAdb("sh", ["-c", "echo early; exec sleep 30"], 100).then(result => {
      answered = result;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(answered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toEqual({ code: -1, text: "", missing: false });
    await running;
  });
});
