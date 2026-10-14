/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines */
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PerfLogLine } from "../../../perf/protocol";
import { readLine } from "../../session/digest";
import { writeLines } from "../../session/writer";
import { createLogSession } from "../../state";
import type { LogSession } from "../../types";
import {
  createCtx,
  deviceOf,
  fileLines,
  headerLine,
  headerWithoutRate,
  LOG,
  rateLine,
  removeDir,
  sampleLine,
  spikeLine,
  tempDir,
  thermalLine
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The live digest of a log: read from typed PerfLogLine items, defensively for
// every field beyond v and kind.
// ─────────────────────────────────────────────────────────────────────────────

let session: LogSession;

/**
 * Reads lines into the session's digest.
 *
 * @param lines - The lines.
 * @returns The digest after them.
 */
function digestOf(...lines: PerfLogLine[]) {
  for (const line of lines) readLine(session, line);
  return session.digest;
}

beforeEach(() => {
  session = createLogSession({
    device: deviceOf(),
    log: LOG,
    file: "/game/never.jsonl",
    model: "SM-A266B"
  });
});

describe("readLine", () => {
  it("follows the newest rate line, else the header (bug: a live line saying 120 after the fall back to 60)", () => {
    expect(digestOf(headerLine(), sampleLine(1000))?.rate).toBe(120);
    expect(digestOf(rateLine(1500, 120, 60))?.rate).toBe(60);
    expect(digestOf(sampleLine(2000))?.rate).toBe(60);
  });

  it("takes the header's maxFps when it has no rate, and null for maxFps 0", () => {
    expect(digestOf(headerWithoutRate(60), sampleLine(1000))?.rate).toBe(60);

    session = createLogSession({ device: deviceOf(), log: LOG, file: "/game/x", model: "X" });
    expect(digestOf(headerWithoutRate(0), sampleLine(1000))?.rate).toBeNull();
  });

  it("computes fps from drawn × 1000 / windowMs and the loop fps from frames", () => {
    expect(digestOf(sampleLine(1000, { drawn: 59, frames: 60, windowMs: 500 }))).toMatchObject({
      fps: 118,
      loopFps: 120
    });
  });

  it("names the header's model, backend, engine and build", () => {
    expect(
      digestOf(
        headerLine(0, { build: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" }),
        sampleLine(1000)
      )
    ).toMatchObject({
      model: "SM-A266B",
      backend: "webgpu",
      engine: "0.14.12+9c41e0",
      build: "debug-20261014T160000Z"
    });
  });

  it("lists only the primary causes of the last 6 s, most frequent first", () => {
    const digest = digestOf(
      spikeLine(1000, ["gpu"]),
      spikeLine(1000, ["gpu"]),
      spikeLine(1000, ["gpu"]),
      spikeLine(4000, ["js"]),
      spikeLine(5000, ["upload", "js"]),
      spikeLine(6000, ["upload"]),
      sampleLine(8000)
    );

    expect(digest?.causes).toEqual(["upload", "js"]);
  });

  it("keeps at most the 64 newest spikes (bug: a long session's spike list growing without end)", () => {
    for (let t = 1; t <= 70; t += 1) readLine(session, spikeLine(t, ["js"]));

    expect(session.recent).toHaveLength(64);
    expect(session.recent[0]?.[0]).toBe(7);
  });

  it("answers null p90 and gpu for a second without them", () => {
    expect(digestOf(sampleLine(1000, { gapMs: null, gpuMs: null }))).toMatchObject({
      p90Ms: null,
      gpuMs: null
    });
    expect(digestOf(sampleLine(2000))).toMatchObject({ p90Ms: 9.1, gpuMs: 4.8 });
  });

  it("keeps the newest heat reading", () => {
    expect(
      digestOf(sampleLine(1000), thermalLine(1500, { status: "light", batteryC: 36.1 }))?.thermal
    ).toEqual({ status: "light", batteryC: 36.1 });
  });
});

describe("malformed lines the hub's shallow guard let through", () => {
  let root: string;

  beforeEach(async () => {
    root = await tempDir();
  });

  afterEach(async () => {
    await removeDir(root);
  });

  it("skips a spike without frame and a sample without windowMs in the digest, and still writes them (bug: one bad line losing its batch)", async () => {
    const ctx = createCtx(root);
    session = createLogSession({
      device: deviceOf(),
      log: LOG,
      file: join(root, "a.jsonl"),
      model: "SM-A266B"
    });
    const spike: PerfLogLine = JSON.parse('{"v":1,"kind":"spike","t":1500}');
    const sample: PerfLogLine = JSON.parse('{"v":1,"kind":"sample","t":2000,"path":"x"}');
    const thermal: PerfLogLine = JSON.parse('{"v":1,"kind":"thermal","t":2100,"status":{}}');

    await writeLines(ctx, session, {
      log: LOG,
      from: 0,
      rx: 1_791_986_090_000,
      items: [sampleLine(1000), spike, sample, thermal],
      gap: 0,
      rejected: 0
    });

    expect(session.digest).toMatchObject({
      t: 1000,
      causes: [],
      thermal: { status: null, batteryC: null }
    });
    expect(session.recent).toEqual([]);
    const written = await fileLines(session.file);
    expect(written.map(line => line.kind)).toEqual(["sample", "spike", "sample", "thermal"]);
  });
});
