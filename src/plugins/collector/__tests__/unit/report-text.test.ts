/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines and summaries */
import { describe, expect, it } from "vitest";
import type { PerfHeaderLine } from "../../../perf/protocol";
import { parsePerfLog, summarize, summaryText, table } from "../../report";
import {
  eventLine,
  gfxLine,
  hasUnsafeChar,
  headerLine,
  histOf,
  jsonl,
  markLine,
  rateLine,
  sampleLine,
  spikeLine,
  telemetryLine,
  thermalLine
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The text tables `perf summary` prints: alignment, ≥200 and — cells, the
// footer wording and the Screen events block.
// ─────────────────────────────────────────────────────────────────────────────

describe("table", () => {
  it("pads name columns right and number columns left, as wide as the widest cell", () => {
    expect(
      table(
        ["path", "fps"],
        [
          ["ward", "59.8"],
          ["garden/boss", "7"]
        ]
      )
    ).toEqual([
      "| path        |  fps |",
      "|-------------|------|",
      "| ward        | 59.8 |",
      "| garden/boss |    7 |"
    ]);
  });

  it("left-aligns as many name columns as `names` says", () => {
    expect(table(["a", "b", "n"], [["x", "y", "1"]], 2)[2]).toBe("| x | y | 1 |");
  });
});

describe("summaryText", () => {
  it("prints the device line, ≥200 for an over percentile and — for a missing value", () => {
    const text = summaryText(
      summarize(
        parsePerfLog(
          jsonl([
            headerLine(0, { engine: null }),
            sampleLine(1000, { frameHist: histOf({ 80: 10 }), gpuMs: null, heapMb: null })
          ])
        )
      )
    );

    expect(text[0]).toBe("SM-A266B · webgpu · engine — · build debug-1 · 1 s");
    const row = text.find(line => line.startsWith("| garden/boss")) ?? "";
    const cells = row.split("|").map(cell => cell.trim());
    expect(cells.slice(1, 12)).toEqual([
      "garden/boss",
      "120",
      "10",
      "≥200",
      "≥200",
      "≥200",
      "—",
      "0",
      "6.0",
      "96 / 32 / 6",
      "—"
    ]);
  });

  it("names the spikes by cause and the marks with (auto) for the engine's own", () => {
    const text = summaryText(
      summarize(
        parsePerfLog(
          jsonl([
            headerLine(),
            sampleLine(1000),
            spikeLine(1100, ["js"]),
            spikeLine(1200, ["upload", "js"]),
            markLine(65_000, "boss enters"),
            markLine(162_000, "garden/boss", true)
          ])
        )
      )
    );

    expect(text.find(line => line.startsWith("| garden/boss"))).toContain("2 (upload 1, js 1)");
    expect(text).toContain("Marks: 01:04 boss enters · 02:41 garden/boss (auto)");
  });

  it("words the footer with lines, skipped by reason and lost lines", () => {
    const lines = Array.from({ length: 1835 }, (_, index) => sampleLine(1000 * (index + 1)));
    const text = jsonl([
      headerLine(),
      ...lines,
      { ...sampleLine(1), v: 2 },
      { ...sampleLine(2), v: 2 },
      { v: 1, kind: "gap", t: 5, build: null, rx: 9, device: "SM-A266B", lines: 12 },
      '{"v":1,"kind":"sam'
    ]);

    const footer = summaryText(summarize(parsePerfLog(text))).at(-1);

    expect(footer).toBe(
      "1 840 lines · 3 skipped (2 of a newer log version, 1 not JSON) · 12 lost on the device"
    );
  });

  it("counts a wired log's telemetry lines in the footer (bug: the wired device's lines read but never named)", () => {
    const text = jsonl([headerLine(), sampleLine(1000), telemetryLine(1500), telemetryLine(2500)]);

    const footer = summaryText(summarize(parsePerfLog(text))).at(-1);

    expect(footer).toBe("4 lines · 2 telemetry lines (wired device)");
  });

  it("prints one Screen events line per screen and rate with trims, warm-ups and overlays", () => {
    const text = summaryText(
      summarize(
        parsePerfLog(
          jsonl([
            headerLine(),
            eventLine(100, "pool-trim", { reason: "scene", freedMb: 41.5 }),
            eventLine(200, "pool-trim", { reason: "scene", freedMb: 41.5 }),
            eventLine(300, "warm", { draws: 12 }),
            eventLine(400, "overlay", {
              entity: 1,
              label: "shopDimLayer",
              what: "open",
              mode: "modal"
            }),
            eventLine(500, "overlay", {
              entity: 2,
              label: "shopDimLayer",
              what: "open",
              mode: "modal"
            }),
            eventLine(600, "overlay", {
              entity: 2,
              label: "shopDimLayer",
              what: "kept",
              mode: "modal"
            }),
            sampleLine(1000),
            eventLine(1500, "warm", { draws: 3 }),
            sampleLine(2000, { path: "shop" })
          ])
        )
      )
    );

    const start = text.findIndex(line => line.startsWith("Screen events:"));
    expect(text[start]).toBe(
      "Screen events: garden/boss @120: pool trims 2 (−83.0 MB) · warm-ups 1 (12 draws) · overlays shopDimLayer open ×2, kept ×1"
    );
    expect(text[start + 1]).toBe(`${" ".repeat(15)}shop @120: warm-ups 1 (3 draws)`);
  });

  it("leaves the Screen events block out for a log without frame events (bug: an empty heading)", () => {
    const text = summaryText(summarize(parsePerfLog(jsonl([headerLine(), sampleLine(1000)]))));

    expect(text.some(line => line.startsWith("Screen events"))).toBe(false);
    expect(text.at(-1)).toBe("2 lines");
  });

  it("prints the heat of each device and the system frames per mark", () => {
    const text = summaryText(
      summarize(
        parsePerfLog(
          jsonl([
            headerLine(),
            sampleLine(1000),
            thermalLine(1000, { batteryC: 31.2, status: 0, sensors: { SKIN: 33.1 } }),
            thermalLine(2000, { batteryC: 38.4, status: 1, sensors: { SKIN: 37 } }),
            thermalLine(3000, { batteryC: 38, status: 1, sensors: { SKIN: 38.4 } }),
            gfxLine(10_000)
          ])
        )
      )
    );

    expect(text).toContain(
      "Heat of SM-A266B: battery 31.2 → 38.0 °C (max 38.4), thermal status 0 → 1 (max 1), SKIN 33.1 → 38.4"
    );
    const heading = text.indexOf("System frames (adb gfxinfo)");
    expect(heading).toBeGreaterThan(0);
    expect(text[heading + 1]).toBe(
      "| device   | mark    | seconds | frames |  fps | late % | p50 | p90 | p99 |"
    );
    expect(text[heading + 3]).toBe(
      "| SM-A266B | (start) |      10 |    600 | 60.0 |    1.0 |  16 |  19 |  25 |"
    );
  });
});

describe("summaryText — phone text", () => {
  it("prints every phone string without control or bidi characters (bug: a log that rewrites the terminal)", () => {
    const evil = "\u001B[2J\u202E\u0085";
    const base = headerLine();
    const header: PerfHeaderLine = {
      ...base,
      build: `b${evil}`,
      engine: `e${evil}`,
      device: { ...base.device, model: `M${evil}` },
      gpu: { ...base.gpu, backend: "webgpu" }
    };
    const text = summaryText(
      summarize(
        parsePerfLog(
          jsonl([
            header,
            sampleLine(1000, { path: `p${evil}` }),
            rateLine(1500, 120, 60, `missed${evil}`),
            eventLine(1600, "overlay", { entity: 1, label: `L${evil}`, what: "open", mode: "x" }),
            sampleLine(2000, { path: `p${evil}` }),
            thermalLine(2100, { device: `D${evil}`, sensors: { [`S${evil}`]: 30 } }),
            gfxLine(2200, { device: `G${evil}` }),
            markLine(2300, `m${evil}`)
          ])
        )
      )
    );

    expect(text.filter(line => hasUnsafeChar(line))).toEqual([]);
    const all = text.join("\n");
    for (const shown of [
      "p[2J",
      "missed[2J",
      "L[2J",
      "D[2J",
      "S[2J",
      "G[2J",
      "m[2J",
      "b[2J",
      "e[2J",
      "M[2J"
    ]) {
      expect(all).toContain(shown);
    }
  });
});
