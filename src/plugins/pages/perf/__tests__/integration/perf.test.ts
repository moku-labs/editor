import { existsSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileLines,
  headerLine,
  sampleLine,
  spikeLine
} from "../../../../collector/__tests__/helpers";
import type { Client } from "../../../../hub/__tests__/integration/clients";
import { connectDevice, isNote } from "../../../../hub/__tests__/integration/clients";
import type { Json } from "../../../../registry/protocol";
import { notification } from "../../../../registry/protocol";
import { createPageDir } from "../../../__tests__/helpers";
import type { Started } from "../../../types";
import { perfDiscoveryPath, readPerfDiscovery } from "../../discovery";
import { perfMark } from "../../mark";
import { runPerf } from "../../run";
import type { PerfArgs, PerfDeps } from "../../types";
import { perfDeps, recordingConsole, removeRoot, tempRoot } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// `moku-editor perf` over the real server core (files, hub, collector, pages)
// on a random device port, adb pointed at a missing command: a phone pairs over
// 127.0.0.1, sends its log; the live lines, the tools page, the no-game page,
// perf mark, the stop and its summary, and the failure paths of the start.
// ─────────────────────────────────────────────────────────────────────────────

/** `moku-editor perf --port 0`. */
const ARGS: PerfArgs = {
  kind: "perf",
  lan: false,
  port: 0,
  out: ".moku/perf",
  every: 10,
  ui: true
};

/** The phone's log name. */
const LOG = "perf-20261014-1532-sm-a266b.jsonl";

let root: string;
let pageDir: string;
const clients: Client[] = [];
const running: Started[] = [];

beforeEach(async () => {
  root = await tempRoot();
  pageDir = await createPageDir();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const started of running.splice(0)) await started.stop?.();
  await removeRoot(root);
  await rm(pageDir, { recursive: true, force: true });
});

/**
 * The deps of a run in the temp root: real files and fetch, adb missing, the built page folder.
 *
 * @returns The deps.
 */
function realDeps(): PerfDeps {
  return perfDeps({
    cwd: () => root,
    pid: process.pid,
    readText: path => readFile(path, "utf8"),
    fetch: (url, init) => fetch(url, init),
    extraConfig: { collector: { adb: "/no/adb" }, pages: { pageDir } }
  });
}

/**
 * Starts a perf run and keeps it for the cleanup.
 *
 * @param args - The arguments.
 * @param deps - The deps.
 * @returns The run and the recorded console.
 */
async function startRun(args: PerfArgs, deps: PerfDeps) {
  const recorded = recordingConsole();
  const started = await runPerf(args, deps, recorded.ui);
  running.push(started);
  return { started, ...recorded };
}

/**
 * A perf.lines batch of the phone's log.
 *
 * @param lines - The lines.
 * @returns The notification.
 */
function batch(lines: readonly object[]) {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- the wire form: JSON values, not a clone
  const wire: Json[] = lines.map(line => JSON.parse(JSON.stringify(line)));
  return notification("editor", "perf.lines", { log: LOG, from: 0, lines: wire });
}

describe("moku-editor perf", () => {
  it("records a phone with live lines, serves the tools page, takes a mark and prints done before the summary", async () => {
    const deps = realDeps();
    const { started, lines } = await startRun(ARGS, deps);
    expect(started.code).toBe(0);

    const found = readPerfDiscovery(root);
    const address = `127.0.0.1:${found?.port}`;
    expect(statSync(perfDiscoveryPath(root)).mode & 0o777).toBe(0o600);
    const tools = await fetch(`http://${address}/__editor/`);
    expect(tools.status).toBe(200);
    const home = await fetch(`http://${address}/`);
    expect(await home.text()).toContain("No game is served here.");

    const phone = await connectDevice(address);
    clients.push(phone);
    phone.send(notification("editor", "pair", { code: "4821", device: { model: "SM-A266B" } }));
    await phone.next(isNote("editor", "paired"));
    phone.send(
      batch([headerLine(100), sampleLine(1100), sampleLine(2100), spikeLine(1200, ["upload"])])
    );
    await phone.next(isNote("editor", "perf.ack"));
    await vi.waitFor(() =>
      expect(lines.some(line => /^ {2}garden\/boss {2}@120 {2}\d+ fps/.test(line))).toBe(true)
    );
    expect(lines.some(line => line.startsWith("◉ SM-A266B · webgpu · engine 0.14.12+9c41e0"))).toBe(
      true
    );
    const rec = lines.find(line => line.startsWith("  ● REC → "));
    expect(rec).toMatch(/^ {2}● REC → \.moku\/perf\/perf-\d{8}-\d{4}-sm-a266b\.jsonl$/);
    const file = join(root, rec?.slice("  ● REC → ".length) ?? "");

    expect(await perfMark({ kind: "perf-mark", label: "boss" }, deps, recordingConsole().ui)).toBe(
      0
    );
    const written = await fileLines(file);
    expect(written.find(line => line.kind === "mark")).toMatchObject({
      label: "boss",
      from: "computer"
    });

    const before = lines.length;
    await started.stop?.();
    const after = lines.slice(before);
    const done = after.findIndex(line => /^ {2}■ SM-A266B · \d+ lines → \.moku\/perf\//.test(line));
    const summary = after.findIndex(line => line.startsWith("  › log .moku/perf/perf-"));
    expect(done).toBeGreaterThanOrEqual(0);
    expect(summary).toBeGreaterThan(done);
    expect(after[summary + 1]).toMatch(/^SM-A266B · webgpu/);
    expect(existsSync(perfDiscoveryPath(root))).toBe(false);
    expect(lines.join("\n")).not.toContain(found?.token ?? "no token");
  });

  it("answers 404 on the tools page with --no-ui", async () => {
    await startRun({ ...ARGS, ui: false }, realDeps());
    const response = await fetch(`http://127.0.0.1:${readPerfDiscovery(root)?.port}/__editor/`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("tools page off (moku-editor perf --no-ui)");
  });

  it("prints the hub's two-line in-use message and answers 1 on a taken port", async () => {
    const holder = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    try {
      const { started, lines } = await startRun({ ...ARGS, port: holder.port ?? 0 }, realDeps());
      expect(started.code).toBe(1);
      expect(lines.join("\n")).toContain(
        `is in use.\n  Is another moku-editor perf running? Try --port ${(holder.port ?? 0) + 1}.`
      );
      expect(existsSync(perfDiscoveryPath(root))).toBe(false);
    } finally {
      await holder.stop(true);
    }
  });

  it("warns and keeps running when .moku/perf.json cannot be written", async () => {
    await writeFile(join(root, ".moku"), "a file, not a folder");
    const { started, lines } = await startRun(ARGS, realDeps());
    expect(started.code).toBe(0);
    expect(lines.join("\n")).toContain("⚠ [moku-editor] could not write .moku/perf.json");
    expect(lines.join("\n")).toContain("Ctrl+C to stop");
  });
});
