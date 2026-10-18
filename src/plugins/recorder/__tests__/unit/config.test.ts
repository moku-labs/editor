import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { perfPlugin } from "../../../perf";
import { registryPlugin } from "../../../registry";
import { recorderPlugin } from "../..";
import type { RecorderConfig } from "../../types";
import { startedGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The config checks at createApp: one two-line TypeError per key.
// ─────────────────────────────────────────────────────────────────────────────

const { createApp } = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, perfPlugin, recorderPlugin]
});

let game: Awaited<ReturnType<typeof startedGame>>;

beforeAll(async () => {
  game = await startedGame();
});

afterAll(async () => {
  await game.stop();
});

describe("the config checks (bug: a config typo that surfaces as a crash on the phone)", () => {
  it.each<[Record<string, unknown>, string]>([
    [
      { keepMb: 0 },
      "[moku-editor] recorder.keepMb is 0.\n  Give megabytes from 1 to 512; 64 keeps about 12 hours of samples."
    ],
    [
      { keepMb: 513 },
      "[moku-editor] recorder.keepMb is 513.\n  Give megabytes from 1 to 512; 64 keeps about 12 hours of samples."
    ],
    [
      { flushEveryMs: Number.NaN },
      "[moku-editor] recorder.flushEveryMs is NaN.\n  Give milliseconds from 100 to 10000; 1000 serializes once a second."
    ],
    [
      { persistEveryMs: 60_001 },
      "[moku-editor] recorder.persistEveryMs is 60001.\n  Give milliseconds from 1000 to 60000; 5000 writes the store every five seconds."
    ],
    [
      { keepFiles: 2.5 },
      "[moku-editor] recorder.keepFiles is 2.5.\n  Give a whole number from 1 to 100; 10 keeps the last ten logs."
    ],
    [
      { autoStart: "yes" },
      '[moku-editor] recorder.autoStart is "yes".\n  Give true, false or "device" (start a log on a debug build only).'
    ],
    [
      { maxLogMb: 0 },
      "[moku-editor] recorder.maxLogMb is 0.\n  Give a whole number of megabytes from 1 to 512; 32 keeps every log shareable."
    ],
    [
      { maxLogMb: 2.5 },
      "[moku-editor] recorder.maxLogMb is 2.5.\n  Give a whole number of megabytes from 1 to 512; 32 keeps every log shareable."
    ],
    [
      { storage: "disk" },
      '[moku-editor] recorder.storage is "disk".\n  Give "auto" (OPFS when the page has it) or "memory" (never on disk).'
    ]
  ])("throws a TypeError at createApp for %o", (recorder, message) => {
    const create = () =>
      createApp({
        pluginConfigs: {
          registry: { game: game.app },
          recorder: recorder as Partial<RecorderConfig>
        }
      });
    expect(create).toThrow(TypeError);
    expect(create).toThrow(message);
  });
});
