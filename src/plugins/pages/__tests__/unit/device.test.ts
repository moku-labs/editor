import { describe, expect, it } from "vitest";
import { parseBinArgs } from "../../args";
import { withDevice } from "../../device";

// The phone of a run (E13): --device, else ANDROID_SERIAL, else none.

describe("withDevice", () => {
  it("takes ANDROID_SERIAL when --device is not given, for the serving bin, mcp and perf", () => {
    const env = { ANDROID_SERIAL: " R5CY32V0J9M " };

    expect(withDevice(parseBinArgs(["a.html"]), env)).toMatchObject({ device: "R5CY32V0J9M" });
    expect(withDevice(parseBinArgs(["mcp"]), env)).toMatchObject({ device: "R5CY32V0J9M" });
    expect(withDevice(parseBinArgs(["perf"]), env)).toMatchObject({ device: "R5CY32V0J9M" });
  });

  it("lets --device win over ANDROID_SERIAL", () => {
    const args = parseBinArgs(["perf", "--device", "emulator-5554"]);

    expect(withDevice(args, { ANDROID_SERIAL: "R5CY32V0J9M" })).toMatchObject({
      device: "emulator-5554"
    });
  });

  it("chooses no phone without either, or with an empty ANDROID_SERIAL (bug E13: a phone attached silently)", () => {
    expect("device" in withDevice(parseBinArgs(["a.html"]), {})).toBe(false);
    expect("device" in withDevice(parseBinArgs(["a.html"]), { ANDROID_SERIAL: "  " })).toBe(false);
  });

  it("leaves a command that serves nothing as it is", () => {
    const args = parseBinArgs(["mcp-config"]);

    expect(withDevice(args, { ANDROID_SERIAL: "R5" })).toBe(args);
  });
});
