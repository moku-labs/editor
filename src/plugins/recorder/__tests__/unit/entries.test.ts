/* eslint-disable unicorn/no-null -- null is "no input" on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandVia } from "../../../registry/protocol";
import type { CommandEntry, SourceEntry } from "../../../registry/types";
import { addRecorderEntries } from "../../entries";
import type { RecordStarter } from "../../types";
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

/**
 * A watch whose tools page went away.
 *
 * @throws {Error} Always.
 */
function failing(): never {
  throw new Error("the tools page went away");
}

describe("editor.record", () => {
  it("starts with { on: true, label } and stops with { on: false }, answering the log's name", async () => {
    const name = "perf-20261014-1532-sm-a266b.jsonl";
    await expect(command("editor.record").run({ on: true, label: "boss" })).resolves.toEqual({
      value: { on: true, file: name, startedBy: { by: "code", name: null }, marked: null },
      state: ENVELOPE
    });
    expect(t.api.status()).toMatchObject({ state: "recording", label: "boss" });
    await expect(command("editor.record").run({ on: false })).resolves.toEqual({
      value: { on: false, file: name, startedBy: null, marked: null },
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

  it.each<[CommandVia | undefined, RecordStarter]>([
    ["mcp", "agent"],
    ["tools", "editor"],
    ["overlay", "phone"],
    ["bridge", "remote"],
    ["local", "code"],
    [undefined, "code"]
  ])('run with via %s names the log started by %s (bug: an agent\'s recording shown as "you")', async (via, by) => {
    await command("editor.record").run({ on: true }, via);
    expect(t.api.status().startedBy).toEqual({ by, name: null });
  });

  it("keeps the MCP client's name for an agent only, cut to 64 characters (bug: the agent's name lost, or a name pinned on a recording the person started)", async () => {
    await expect(
      command("editor.record").run({ on: true }, "mcp", "Claude")
    ).resolves.toMatchObject({ value: { startedBy: { by: "agent", name: "Claude" } } });
    expect(t.api.status().startedBy).toEqual({ by: "agent", name: "Claude" });
    expect(t.monitor.events.find(event => event.name === "recorder")?.detail).toEqual({
      action: "start",
      label: null,
      by: "agent",
      name: "Claude"
    });
    await command("editor.record").run({ on: false }, "mcp", "Claude");

    await command("editor.record").run({ on: true }, "tools", "Claude");
    expect(t.api.status().startedBy).toEqual({ by: "editor", name: null });
    await command("editor.record").run({ on: false });

    await command("editor.record").run({ on: true }, "mcp", "C".repeat(100));
    expect(t.api.status().startedBy?.name).toBe("C".repeat(64));
  });

  it('a second { on: true } from another origin keeps the first startedBy (bug: the label flipping to "agent" when the agent re-asks)', async () => {
    await command("editor.record").run({ on: true }, "overlay");
    await expect(
      command("editor.record").run({ on: true }, "mcp", "Claude")
    ).resolves.toMatchObject({ value: { on: true, startedBy: { by: "phone", name: null } } });
    expect(t.api.status().startedBy).toEqual({ by: "phone", name: null });
  });

  it("{ on: true, mark } starts and then marks in one call (bug: the mark lost because it ran before the start)", async () => {
    await expect(
      command("editor.record").run({ on: true, mark: "boss intro" }, "mcp")
    ).resolves.toMatchObject({ value: { on: true, marked: true } });
    expect(t.monitor.marks).toEqual(["boss intro"]);
    expect(t.api.marks()).toMatchObject([{ label: "boss intro", auto: false }]);
  });

  it("{ mark } alone marks the running log and changes nothing else; while idle it marks nothing and starts nothing", async () => {
    await expect(command("editor.record").run({ mark: "x" })).resolves.toEqual({
      value: { on: false, file: null, startedBy: null, marked: false },
      state: ENVELOPE
    });
    expect(t.api.status().state).toBe("idle");
    const { name } = t.api.start();
    await expect(command("editor.record").run({ mark: "  boss  " }, "tools")).resolves.toEqual({
      value: { on: true, file: name, startedBy: { by: "code", name: null }, marked: true },
      state: ENVELOPE
    });
    expect(t.monitor.marks).toEqual(["boss"]);
  });

  it("{ on: false } stops a recording another origin started (an agent's log stoppable by hand)", async () => {
    await command("editor.record").run({ on: true }, "mcp", "Claude");
    await command("editor.record").run({ on: false }, "overlay");
    expect(t.api.status()).toMatchObject({ state: "idle", startedBy: null });
  });

  it.each([
    {},
    null,
    { mark: " " },
    { label: "boss" }
  ])("rejects %o with -32602 and leaves a running log alone (bug: an empty call that stops a recording)", async input => {
    t.api.start();
    await expect(command("editor.record").run(input)).rejects.toMatchObject({
      code: -32_602,
      message:
        '[moku-editor] editor.record needs on or mark.\n  Pass { on: true } to start, { on: false } to stop, { mark: "boss intro" } to mark.'
    });
    expect(t.api.status().state).toBe("recording");
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
    expect(source().read(null)).toEqual({ ...t.api.status(), marks: [] });
    const seen: unknown[] = [];
    const stop = source().watch(null, value => seen.push(value));
    t.api.start();
    await t.api.stop();
    expect(seen).toMatchObject([{ state: "recording", monitor: true }, { state: "idle" }]);
    stop();
    t.api.start();
    expect(seen).toHaveLength(2);
  });

  it("carries startedBy (null while idle) and the last 32 marks of the log (bug: the popover's marks list empty while the overlay shows them)", () => {
    expect(source().read(null)).toMatchObject({ startedBy: null, marks: [] });
    t.api.start({ by: "agent", name: "Claude" });
    for (let index = 1; index <= 40; index += 1) t.api.mark(`m${index}`);
    const value = source().read(null);
    expect(value).toMatchObject({ state: "recording", startedBy: { by: "agent", name: "Claude" } });
    const labels = (Reflect.get(Object(value), "marks") as { label: string }[]).map(
      mark => mark.label
    );
    expect(labels).toEqual(Array.from({ length: 32 }, (_, index) => `m${index + 9}`));
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

describe("the watches of editor.recorder", () => {
  it("isolates a failing watch: the others and the event go on, one warn per streak", async () => {
    const seen: unknown[] = [];
    const stopFailing = source().watch(null, failing);
    source().watch(null, value => seen.push(Reflect.get(Object(value), "state")));
    const warns = () =>
      t.log.warn.mock.calls.filter(([event]) => event === "recorder:watcher-failed").length;

    t.api.start();
    await t.api.stop();
    expect(seen).toEqual(["recording", "idle"]);
    expect(t.emit).toHaveBeenCalledTimes(2);
    expect(warns()).toBe(1);

    stopFailing();
    t.api.start();
    source().watch(null, failing);
    await t.api.stop();
    expect(warns()).toBe(2);
  });
});
