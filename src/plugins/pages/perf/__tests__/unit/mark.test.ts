/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePerfDiscovery } from "../../discovery";
import { perfMark } from "../../mark";
import type { PerfDeps } from "../../types";
import { perfDeps, recordingConsole, removeRoot, tempRoot } from "../helpers";

/** The token of the running perf. */
const TOKEN = "s".repeat(43);

let root: string;
let release: () => void;

beforeEach(async () => {
  root = await tempRoot();
  release = writePerfDiscovery(root, {
    pid: 4242,
    port: 47_600,
    path: "/__editor",
    token: TOKEN,
    lan: null,
    startedAt: 1
  });
});

afterEach(async () => {
  release();
  await removeRoot(root);
});

/**
 * Runs `perf mark "boss"` in the temp root with a fetch that answers a status and a body.
 *
 * @param fetch - The fetch stub.
 * @param overrides - Other deps.
 * @returns The exit code and the printed lines.
 */
async function markWith(fetch: PerfDeps["fetch"], overrides: Partial<PerfDeps> = {}) {
  const { ui, lines } = recordingConsole();
  const deps = perfDeps({ cwd: () => root, fetch, ...overrides });
  const code = await perfMark({ kind: "perf-mark", label: "boss" }, deps, ui);
  return { code, lines, deps };
}

/**
 * A fetch stub answering one status and body.
 *
 * @param status - The status.
 * @param body - The body.
 * @returns The stub.
 */
function answering(status: number, body: string) {
  return vi.fn<PerfDeps["fetch"]>(() =>
    Promise.resolve({ status, text: () => Promise.resolve(body) })
  );
}

describe("perfMark", () => {
  it("posts the label with the run's Bearer token to its mark route and prints the count", async () => {
    const fetch = answering(200, '{"marked":2}');
    const { code, lines } = await markWith(fetch);
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:47600/__editor/perf/mark", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "text/plain; charset=utf-8"
      },
      body: "boss"
    });
    expect(lines).toEqual(['  ✓ mark "boss" in 2 log(s)']);
  });

  it("warns and still answers 0 when no phone is live", async () => {
    const { code, lines } = await markWith(answering(200, '{"marked":0}'));
    expect(code).toBe(0);
    expect(lines).toEqual(["  ⚠ no phone is live: the mark went into no log"]);
  });

  it("answers 1 without a perf.json, and with the pid of a run that is gone", async () => {
    const message =
      "  ✗ [moku-editor] No moku-editor perf runs in this folder.\n  Start one with moku-editor perf.";
    release();
    const none = await markWith(answering(200, '{"marked":1}'));
    expect(none.code).toBe(1);
    expect(none.lines).toEqual([message]);

    release = writePerfDiscovery(root, {
      pid: 99,
      port: 1,
      path: "/__editor",
      token: TOKEN,
      lan: null,
      startedAt: 1
    });
    const fetch = answering(200, '{"marked":1}');
    const dead = await markWith(fetch, { isAlive: pid => pid !== 99 });
    expect(dead.code).toBe(1);
    expect(dead.lines).toEqual([message]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 1 with the restart hint on 401", async () => {
    const { code, lines } = await markWith(answering(401, "unauthorized"));
    expect(code).toBe(1);
    expect(lines).toEqual([
      "  ✗ [moku-editor] The running perf has another token.\n  Restart moku-editor perf."
    ]);
  });

  it("answers 1 with the check hint on a network error and on another status", async () => {
    const refused = await markWith(() => Promise.reject(new Error("Unable to connect")));
    expect(refused.code).toBe(1);
    expect(refused.lines).toEqual([
      "  ✗ [moku-editor] Unable to connect\n  Check that moku-editor perf still runs."
    ]);
    const busy = await markWith(answering(503, "not started"));
    expect(busy.code).toBe(1);
    expect(busy.lines[0]).toMatch(/503.*\n {2}Check that moku-editor perf still runs\.$/);
  });
});

describe("perfMark hardening (W1, W2)", () => {
  it("refuses a perf.json whose path leads to another host, without a request", async () => {
    release();
    release = writePerfDiscovery(root, {
      pid: 4242,
      port: 47_600,
      path: "//evil.example",
      token: TOKEN,
      lan: null,
      startedAt: 1
    });
    const fetch = answering(200, '{"marked":1}');
    const { code, lines } = await markWith(fetch);
    expect(code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ {2}✗ \[moku-editor\] [^\n]*evil\.example[^\n]*\n {2}\S[^\n]*$/);
  });

  it("prints the reply body on one line without control characters, at most 120 characters", async () => {
    const odd = await markWith(answering(500, "boom\n\u001B[2Jline two\r\n"));
    expect(odd.lines).toEqual([
      "  ✗ [moku-editor] perf mark: the running perf answered 500 boom [2Jline two\n  Check that moku-editor perf still runs."
    ]);
    const long = await markWith(answering(500, "x".repeat(300)));
    expect(long.lines[0]).toContain(`500 ${"x".repeat(120)}\n`);
  });
});
