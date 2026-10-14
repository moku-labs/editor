import { describe, expect, it } from "vitest";
import { runAdb } from "../../adb/run";

// ─────────────────────────────────────────────────────────────────────────────
// runAdb, the one process seam: what a missing command and a hung one answer.
// ─────────────────────────────────────────────────────────────────────────────

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

  it("kills a command that outlives the timeout and answers code -1 without text", async () => {
    const started = Date.now();

    const result = await runAdb("sh", ["-c", "echo early; sleep 5"], 100);

    expect(result).toEqual({ code: -1, text: "", missing: false });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
