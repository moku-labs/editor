/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
import { describe, expect, it } from "vitest";
import type { PerfReady } from "../../print";
import { printPerfReady } from "../../print";
import { recordingConsole } from "../helpers";

/** A run with --lan, the tools page on and no app id. */
const READY: PerfReady = {
  listen: { port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" },
  path: "/__editor",
  tools: true,
  logs: "/game/.moku/perf",
  engine: "0.14.12+9c41e0",
  appId: undefined,
  reverseEveryMs: 2000
};

/**
 * The printed lines of a ready block.
 *
 * @param ready - What the run knows.
 * @returns The lines.
 */
function printed(ready: PerfReady): string[] {
  const { ui, lines } = recordingConsole();
  printPerfReady(ui, ready);
  return lines;
}

describe("printPerfReady", () => {
  it("prints the phones, LAN, tools, logs and engine rows, the wait line, the app id hint and Ctrl+C", () => {
    const text = printed(READY).join("\n");
    expect(text).toContain("moku editor  perf");
    expect(text).toContain("| Phones  127.0.0.1:47600 · adb reverse every 2 s");
    expect(text).toContain("| LAN     192.168.1.5:47600 · a phone pairs by its code");
    expect(text).toContain("| Tools   http://127.0.0.1:47600/__editor/#render");
    expect(text).toContain("| Logs    /game/.moku/perf");
    expect(text).toContain("| Engine  0.14.12+9c41e0");
    expect(text).toContain(
      "› Waiting for a phone: a debug build dials 127.0.0.1:47600 (moku-game build --debug)."
    );
    expect(text).toContain(
      "› No app id: gfx lines are off. Set native.identifier in config.ts or pluginConfigs.collector.appId."
    );
    expect(printed(READY).at(-1)).toBe("  › Ctrl+C to stop");
  });

  it("leaves out the LAN row without --lan, the Tools row with --no-ui and the hint with an app id", () => {
    const text = printed({
      ...READY,
      listen: { ...READY.listen, lan: null },
      tools: false,
      appId: "com.example.garden"
    }).join("\n");
    expect(text).not.toContain("LAN ");
    expect(text).not.toContain("Tools");
    expect(text).not.toContain("No app id");
  });
});
