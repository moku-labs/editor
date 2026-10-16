import { describe, expect, it } from "vitest";
import { runAdb } from "../../wire/run";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C7: the runner seam — Bun.spawn, stdout piped, killed after the
// timeout, code 127 + missing for a command that does not exist, never rejects.
// The command here is this Bun itself (a real process, no adb needed).
// ─────────────────────────────────────────────────────────────────────────────

describe("runAdb", () => {
  it("answers the exit code and standard output", async () => {
    const result = await runAdb(
      process.execPath,
      ["-e", "console.log('40211'); process.exit(3)"],
      5000
    );
    expect(result).toEqual({ code: 3, text: "40211\n", missing: false });
  });

  it("answers 127 and missing for a command that does not exist", async () => {
    // Bug: "adb not found" read as a phone that answered nothing.
    await expect(runAdb("/nonexistent/platform-tools/adb", ["version"], 5000)).resolves.toEqual({
      code: 127,
      text: "",
      missing: true
    });
  });

  it("kills a command that runs past the timeout and answers −1", async () => {
    // Bug: a hung adb holding a tick forever.
    const started = Date.now();
    const result = await runAdb(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], 200);
    expect(result).toEqual({ code: -1, text: "", missing: false });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
