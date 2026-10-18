/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import type { LogEntry } from "@moku-labs/common";
import { describe, expect, it } from "vitest";
import { perfSink } from "../../log";
import { recordingConsole } from "../helpers";

/**
 * Writes entries through the perf sink and answers what the console printed.
 *
 * @param entries - The log entries.
 * @returns The printed lines.
 */
function printed(entries: readonly Omit<LogEntry, "ts">[]): string[] {
  const { ui, lines } = recordingConsole();
  const sink = perfSink(ui);
  for (const entry of entries) sink.write({ ...entry, ts: 0 });
  return lines;
}

describe("perfSink", () => {
  it("prints the pairing and adb info events as sentences", () => {
    expect(
      printed([
        { level: "info", event: "hub:paired", data: { id: "d-1", model: "SM-A266B", link: "adb" } },
        {
          level: "info",
          event: "hub:pair-refused",
          data: { address: "192.168.1.23", model: "SM-A266B" }
        },
        {
          level: "info",
          event: "collector:reversed",
          data: { serial: "R5CX30ABCDE", model: "SM-A266B", port: 47_600 }
        },
        {
          level: "info",
          event: "collector:adb-missing",
          data: {
            hint: "USB phones need Android platform-tools (adb) on PATH; a LAN phone works without it"
          }
        },
        { level: "info", event: "collector:adb-ambiguous", data: { model: "SM-A266B" } }
      ])
    ).toEqual([
      "  ✓ SM-A266B linked over adb",
      "  ✗ SM-A266B at 192.168.1.23 was refused",
      "  ✓ SM-A266B (R5CX30ABCDE): its 127.0.0.1:47600 leads here (adb reverse)",
      "  › adb not found: USB phones need Android platform-tools (adb) on PATH; a LAN phone works without it",
      "  › two SM-A266B phones over adb: heat and system frames are off for them"
    ]);
  });

  it("names a phone without a model 'A phone'", () => {
    expect(
      printed([
        { level: "info", event: "hub:paired", data: { id: "d-1", model: null, link: "lan" } }
      ])
    ).toEqual(["  ✓ A phone linked over lan"]);
  });

  it("drops every other info entry and every debug entry", () => {
    expect(
      printed([
        { level: "info", event: "hub:started", data: { path: "/__editor" } },
        { level: "debug", event: "hub:paired", data: { model: "SM-A266B", link: "adb" } }
      ])
    ).toEqual([]);
  });

  it("still prints warnings and errors as the event and its JSON, so an adb failure is not silent", () => {
    expect(
      printed([
        { level: "warn", event: "collector:reverse-failed", data: { serial: "R5", model: null } },
        { level: "error", event: "hub:emit-failed" }
      ])
    ).toEqual(['  ⚠ collector:reverse-failed {"serial":"R5","model":null}', "  ✗ hub:emit-failed"]);
  });
});

describe("perfSink hardening (I5, I9)", () => {
  it("cleans the adb serial of control characters", () => {
    expect(
      printed([
        {
          level: "info",
          event: "collector:reversed",
          data: { serial: "R5\u001B[2J\u202EX", model: "SM-A266B", port: 47_600 }
        }
      ])
    ).toEqual(["  ✓ SM-A266B (R5[2JX): its 127.0.0.1:47600 leads here (adb reverse)"]);
  });

  it("never prints undefined for a missing field", () => {
    const lines = printed([
      { level: "info", event: "hub:paired", data: { model: "SM-A266B" } },
      { level: "info", event: "hub:pair-refused", data: {} },
      { level: "info", event: "collector:reversed", data: {} },
      { level: "info", event: "collector:adb-missing" },
      { level: "info", event: "collector:adb-ambiguous", data: {} }
    ]);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).not.toContain("undefined");
  });
});
