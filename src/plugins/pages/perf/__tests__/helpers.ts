import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import type { BrandConsole } from "@moku-labs/common/cli";
import { createBrandConsole } from "@moku-labs/common/cli";
import { vi } from "vitest";
import { deviceOf, headerLine, sampleLine, spikeLine } from "../../../collector/__tests__/helpers";
import type { CollectorSessionEvent, SessionDigest } from "../../../collector/types";
import type { PerfDeps } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the perf CLI tests: a recording brand console (no colour), a
// PerfDeps stub, a temp folder, a collector:session event with a digest, and
// the text of a small perf log built from the collector's line fixtures.
// ─────────────────────────────────────────────────────────────────────────────

/** A brand console that records every line it writes, plain text. */
export type Recorded = { readonly ui: BrandConsole; readonly lines: string[] };

/**
 * A brand console without colour whose lines (stdout and stderr) go to one array.
 *
 * @returns The console and its lines.
 */
export function recordingConsole(): Recorded {
  const lines: string[] = [];
  const ui = createBrandConsole({
    write: line => lines.push(line),
    writeError: line => lines.push(line),
    color: false
  });
  return { ui, lines };
}

/**
 * A PerfDeps stub: cwd `/game`, pid 4242 alive, an `ask` that answers "", a `readText` that
 * rejects, a `fetch` that answers 200 `{"marked":1}`, no app id.
 *
 * @param overrides - Members to replace.
 * @returns The stub.
 */
export function perfDeps(overrides: Partial<PerfDeps> = {}): PerfDeps {
  return {
    cwd: () => "/game",
    pid: 4242,
    isAlive: () => true,
    ask: vi.fn(() => Promise.resolve("")),
    readText: () => Promise.reject(new Error("ENOENT: no such file")),
    fetch: vi.fn(() =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('{"marked":1}') })
    ),
    appIdOf: () => Promise.resolve(undefined),
    ...overrides
  };
}

/**
 * A fresh temp folder, its real path (macOS /var is a link).
 *
 * @returns The folder.
 */
export async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "moku-perf-")));
}

/**
 * Removes a temp folder.
 *
 * @param dir - The folder.
 * @returns When it is gone.
 */
export function removeRoot(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

/**
 * The digest of the spec's stats line: garden/boss at 60, 54 fps, p90 18.2, gpu 6.1, two spikes,
 * 38.0 °C.
 *
 * @param overrides - Fields to change.
 * @returns The digest.
 */
export function digestOf(overrides: Partial<SessionDigest> = {}): SessionDigest {
  return {
    t: 5917.4,
    path: "garden/boss",
    fps: 54,
    loopFps: 60,
    p90Ms: 18.2,
    gpuMs: 6.1,
    rate: 60,
    spikes: 2,
    causes: ["upload", "gc?"],
    thermal: { status: 1, batteryC: 38 },
    model: "SM-A266B",
    backend: "webgpu",
    engine: "0.14.12+9c41e0",
    build: "debug-20261014T160000Z",
    ...overrides
  };
}

/** The relative file of the fixture log. */
export const LOG_FILE = ".moku/perf/perf-20261014-1532-sm-a266b.jsonl";

/**
 * A collector:session event of the fixture phone: live, 1840 lines, the spec's digest.
 *
 * @param overrides - Fields to change.
 * @returns The event.
 */
export function sessionEvent(
  overrides: Partial<CollectorSessionEvent> = {}
): CollectorSessionEvent {
  return {
    device: deviceOf({ build: "debug-20261014T160000Z" }),
    file: LOG_FILE,
    state: "live",
    lines: 1840,
    lost: 0,
    last: digestOf(),
    ...overrides
  };
}

/**
 * The text of a perf log: a header (rate 120), samples of the given screens and one spike.
 *
 * @param screens - Each sample's path and frame-gap bucket (index 8 is about 8 ms).
 * @returns The JSONL text.
 */
export function perfLogText(
  screens: readonly { readonly path: string; readonly bucket: number }[] = [
    { path: "garden/boss", bucket: 8 }
  ]
): string {
  const samples = screens.flatMap((screen, index) =>
    [0, 1, 2].map(second => {
      const hist = Array.from({ length: 81 }, (_, at) => (at === screen.bucket ? 118 : 0));
      return sampleLine(1000 + index * 3000 + second * 1000, {
        path: screen.path,
        frameHist: hist
      });
    })
  );
  const lines = [headerLine(100), ...samples, spikeLine(1200, ["upload"])];
  return `${lines.map(line => JSON.stringify(line)).join("\n")}\n`;
}

/**
 * Writes a file under a folder.
 *
 * @param dir - The folder.
 * @param name - The file name.
 * @param text - The text.
 * @returns The absolute path.
 */
export async function writeIn(dir: string, name: string, text: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}
