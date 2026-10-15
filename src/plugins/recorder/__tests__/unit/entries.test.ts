/* eslint-disable unicorn/no-null -- null is "no input" on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEntry, SourceEntry } from "../../../registry/types";
import { addRecorderEntries } from "../../entries";
import type { TestRecorder } from "../helpers";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The registry entries: the mirrors editor.record and editor.mark, and the
// source editor.recorder whose watch follows the status event.
// ─────────────────────────────────────────────────────────────────────────────

let t: TestRecorder;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
  t = recorder();
  addRecorderEntries(t.ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The command the recorder added under an id.
 *
 * @param id - The command id.
 * @returns The entry.
 */
function command(id: string): CommandEntry {
  const entry = t.added.find(added => added.descriptor.id === id);
  if (entry === undefined || !("run" in entry)) throw new Error(`no command ${id}`);
  return entry;
}

/**
 * The editor.recorder source.
 *
 * @returns The entry.
 */
function source(): SourceEntry {
  const entry = t.added.find(added => added.descriptor.id === "editor.recorder");
  if (entry === undefined || !("read" in entry)) throw new Error("no source");
  return entry;
}

const ENVELOPE = { path: "home", frame: 12, tainted: false };

describe("editor.record", () => {
  it("starts with { on: true, label } and stops with { on: false }, answering the log's name", async () => {
    const name = "perf-20261014-1532-sm-a266b.jsonl";
    await expect(command("editor.record").run({ on: true, label: "boss" })).resolves.toEqual({
      value: { on: true, file: name },
      state: ENVELOPE
    });
    expect(t.api.status()).toMatchObject({ state: "recording", label: "boss" });
    await expect(command("editor.record").run({ on: false })).resolves.toEqual({
      value: { on: false, file: name },
      state: ENVELOPE
    });
    expect(t.api.status().state).toBe("idle");
    await expect(command("editor.record").run({ on: false })).resolves.toMatchObject({
      value: { on: false, file: null }
    });
  });

  it("is a cosmetic command: it changes the log, never the game", () => {
    expect(command("editor.record").descriptor.effect).toBe("cosmetic");
    expect(command("editor.mark").descriptor.effect).toBe("cosmetic");
  });
});

describe("editor.mark", () => {
  it("answers { marked } of mark(label)", async () => {
    await expect(command("editor.mark").run({ label: "boss" })).resolves.toMatchObject({
      value: { marked: false }
    });
    t.api.start();
    await expect(command("editor.mark").run({ label: "boss" })).resolves.toEqual({
      value: { marked: true },
      state: ENVELOPE
    });
    expect(t.monitor.marks).toEqual(["boss"]);
  });
});

describe("bad input", () => {
  it.each([
    ["editor.record", { on: "yes" }],
    ["editor.record", { on: true, extra: 1 }],
    ["editor.mark", null]
  ])("%s rejects %o with -32602", async (id, input) => {
    await expect(command(id).run(input)).rejects.toMatchObject({ code: -32_602 });
  });
});

describe("editor.recorder", () => {
  it("answers status() and its watch fires on each status emit (bug: a tools REC light that never changes)", async () => {
    expect(source().read(null)).toEqual(t.api.status());
    const seen: unknown[] = [];
    const stop = source().watch(null, value => seen.push(value));
    t.api.start();
    await t.api.stop();
    expect(seen).toMatchObject([{ state: "recording", monitor: true }, { state: "idle" }]);
    stop();
    t.api.start();
    expect(seen).toHaveLength(2);
  });

  it("is a frame source without a probe: available without a monitor, answering monitor false", () => {
    const blind = recorder({ monitor: false });
    addRecorderEntries(blind.ctx);
    const entry = blind.added.find(
      added => added.descriptor.id === "editor.recorder"
    ) as SourceEntry;
    expect(entry.descriptor.changes).toBe("frame");
    expect(entry.probe).toBeUndefined();
    expect(entry.read(null)).toMatchObject({ monitor: false, state: "idle" });
  });
});
