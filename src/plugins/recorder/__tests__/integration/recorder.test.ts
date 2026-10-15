import { defineCommand } from "@moku-labs/game/control";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { createFakeMonitor, sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { perfPlugin } from "../../../perf";
import type { PerfLogLine } from "../../../perf/protocol";
import { registryPlugin } from "../../../registry";
import type { DevModule, GameLike } from "../../../registry/types";
import { recorderPlugin } from "../..";
import { createOpfsStore, OPFS_DIR } from "../../store";
import type { RecorderConfig, RecorderStatusEvent } from "../../types";
import { createFakeDirectory } from "../fake-opfs";
import { kinds, startedGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The recorder in a real agent app [registry, channel, perf, recorder] on a
// started headless game with the engine-like fake monitor grafted on; then the
// same app on a game without a renderer.
// ─────────────────────────────────────────────────────────────────────────────

const { createApp } = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin]
});

/** A plugin that depends on the recorder and keeps every recorder:status it hears (like the bridge). */
const observerPlugin = createAgentPlugin("observer", {
  depends: [recorderPlugin],
  createState: (): { seen: RecorderStatusEvent[] } => ({ seen: [] }),
  api: ctx => ({ seen: (): readonly RecorderStatusEvent[] => ctx.state.seen }),
  hooks: ctx => ({
    "recorder:status": payload => {
      ctx.state.seen.push(payload);
    }
  })
});

/** A module command of the game, cosmetic. */
const glowModule: DevModule = {
  commands: [
    defineCommand({
      id: "tiny.glow",
      title: "Glow",
      input: { on: "boolean" },
      effect: "cosmetic",
      run: (_app: GameLike, { on }) => on
    })
  ]
};

/** The recorder's options of most tests: on the dev page they use, a log starts only when asked. */
const RECORD_ALWAYS: Partial<RecorderConfig> = { autoStart: true };

/** The flags of a dev page. */
const DEV_PAGE: Readonly<Record<string, boolean>> = { __MOKU_GAME_DEV__: true };

/** What each test stops. */
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0).toReversed()) await stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Starts a headless game, grafts a renderer with the monitor (when given) and starts the agent app
 * on it with the observer.
 *
 * @param monitor - The monitor; none for a game without a renderer.
 * @param storage - The recorder's storage.
 * @param recorder - The recorder's other options (autoStart true by default: a dev page records
 *   only when asked).
 * @param flags - The page's build flags (a dev page by default).
 * @returns The agent app.
 */
async function startEditor(
  monitor?: FakeMonitor,
  storage: "auto" | "memory" = "memory",
  recorder: Partial<RecorderConfig> = RECORD_ALWAYS,
  flags: Readonly<Record<string, boolean>> = DEV_PAGE
) {
  for (const [name, value] of Object.entries(flags)) vi.stubGlobal(name, value);
  const game = await startedGame();
  stops.push(() => game.stop());
  const grafted: GameLike =
    monitor === undefined
      ? game.app
      : Object.create(game.app, { renderer: { value: { monitor } } });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
  const editor = createApp({
    plugins: [observerPlugin],
    pluginConfigs: {
      registry: { game: grafted, modules: [glowModule] },
      recorder: { storage, ...recorder }
    }
  });
  editor.log.clearSinks();
  await editor.start();
  stops.push(() => editor.stop());
  return editor;
}

/**
 * The lines of a run, parsed.
 *
 * @param lines - JSON texts of the outbox.
 * @returns The log lines.
 */
function parsed(lines: readonly string[] | undefined): PerfLogLine[] {
  return (lines ?? []).map(text => JSON.parse(text) as PerfLogLine);
}

describe("the recorder on a game with a monitor", () => {
  it("records from start, ships through the outbox, logs commands once and starts each log with the header", async () => {
    const monitor = createFakeMonitor({ capacity: 64 });
    const editor = await startEditor(monitor);
    const { name } = editor.recorder.files()[0] ?? { name: "" };
    expect(editor.recorder.status()).toMatchObject({
      state: "recording",
      monitor: true,
      file: name
    });

    for (let frame = 1; frame <= 3; frame += 1) {
      monitor.emit(sampleLine(frame));
      vi.advanceTimersByTime(1000);
    }
    expect(editor.recorder.files()[0]).toMatchObject({ name, lines: 5, current: true });
    const run = editor.recorder.unsentRun(100);
    expect(kinds(parsed(run?.lines))).toEqual([
      "header",
      "event:recorder",
      "sample",
      "sample",
      "sample"
    ]);

    editor.recorder.ack(name, 5);
    vi.advanceTimersByTime(1000);
    expect(editor.observer.seen().at(-1)).toEqual({
      state: "recording",
      lines: 5,
      bytes: editor.recorder.files()[0]?.bytes,
      sent: 5,
      pending: 0
    });

    await expect(
      editor.registry.command("editor.mark")?.run({ label: "boss" })
    ).resolves.toMatchObject({
      value: { marked: true }
    });
    expect(monitor.marks).toEqual(["boss"]);

    await editor.channel.run("tiny.glow", { on: false }, "bridge");
    vi.advanceTimersByTime(1000);
    const commands = parsed(editor.recorder.unsentRun(100)?.lines).filter(
      line => line.kind === "event" && line.name === "command" && line.detail.id === "tiny.glow"
    );
    expect(commands).toMatchObject([
      { detail: { id: "tiny.glow", input: { on: false }, via: "bridge", ok: true } }
    ]);

    const finished = await editor.recorder.stop();
    expect(finished).toMatchObject({ name, current: false });
    editor.recorder.ack(name, 1000);
    const second = editor.recorder.start({ label: "second" });
    vi.advanceTimersByTime(1000);
    expect(editor.recorder.unsentRun(1)).toMatchObject({ log: second.name, from: 0 });
    expect(kinds(parsed(editor.recorder.unsentRun(1)?.lines))).toEqual(["header"]);

    await editor.stop();
    stops.pop();
    const begins = monitor.begins;
    vi.advanceTimersByTime(5000);
    expect([monitor.begins, monitor.listeners, vi.getTimerCount()]).toEqual([begins, 0, 0]);
    expect(editor.recorder.files().at(-1)).toMatchObject({ name: second.name, current: false });
  });
});

describe('autoStart "device", the default', () => {
  it.each([
    ["a debug build (agent flag on, dev flag off)", { __MOKU_GAME_AGENT__: true }, "recording"],
    ["a dev page (dev flag on)", { __MOKU_GAME_DEV__: true, __MOKU_GAME_AGENT__: true }, "idle"]
  ])("on %s the recorder is %s at start (bug: a dev page that records without bound)", async (_label, flags, state) => {
    const editor = await startEditor(createFakeMonitor(), "memory", {}, flags);
    expect(editor.recorder.status().state).toBe(state);
    expect(editor.recorder.start().current).toBe(true);
  });
});

describe("the recorder on a game without a renderer", () => {
  it("refuses start (also through editor.record) and still lists the logs an earlier page left", async () => {
    const top = createFakeDirectory();
    const root = await top.getDirectoryHandle(OPFS_DIR, { create: true });
    await createOpfsStore(root).append(
      {
        name: "perf-20261013-2210-sm-a266b.jsonl",
        label: "night run",
        startedAt: 1_792_000_000_000,
        lines: 1,
        bytes: 3,
        sent: 0,
        current: false,
        storage: "opfs"
      },
      "{}\n"
    );
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => top } });
    const editor = await startEditor(undefined, "auto");
    expect(editor.recorder.status()).toMatchObject({ monitor: false, state: "idle" });
    expect(() => editor.recorder.start()).toThrow(
      "[moku-editor] recorder.start: this game has no performance monitor."
    );
    await expect(editor.registry.command("editor.record")?.run({ on: true })).rejects.toMatchObject(
      {
        code: -32_000,
        message: expect.not.stringContaining("\n")
      }
    );
    expect(editor.recorder.files().map(file => file.name)).toEqual([
      "perf-20261013-2210-sm-a266b.jsonl"
    ]);
  });
});
