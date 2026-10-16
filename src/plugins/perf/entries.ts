/* eslint-disable unicorn/no-null -- null is "no spike record" on the wire (spec 03 editor.perf.spike) */
/**
 * @file perf plugin — the registry sources (`editor.perf.second`, `editor.perf.window`,
 * `editor.perf.spikes`, `editor.perf.spike` and the MCP mirror `editor.spikes`; Mission control's
 * `editor.perf.frames`, `editor.perf.events`, `editor.perf.passes`, `editor.perf.detail`), the
 * command `editor.perf.sections`, the watches the reads notify, and the reason a game without a
 * monitor gives.
 */
import type { InputSchema, Json } from "../registry/protocol";
import { checkInput, toWireValue } from "../registry/protocol";
import type { RegistryApi, SourceEntry } from "../registry/types";
import {
  detailOf,
  eventsWireOf,
  framesWireOf,
  passesWireOf,
  runSections,
  SECTIONS_INPUT
} from "./feeds";
import { writeWireWindow } from "./protocol";
import { secondOf, spikeRecord, spikeSummaries } from "./records";
import type { PerfConfig, PerfState } from "./types";

/** The input of `editor.perf.spike`. */
const SPIKE_INPUT = { frame: "number" } as const;

/** The input of `editor.spikes`. */
const LAST_INPUT = { lastMs: "number?" } as const;

/** The input of `editor.perf.frames` and `editor.perf.events`: the newest frame / seq the reader has. */
const AFTER_INPUT = { after: "number?" } as const;

/** The input of `editor.perf.detail`: the range's two frames. */
const RANGE_INPUT = { from: "number", to: "number" } as const;

/**
 * Adds a watch to perf's watchers: it is called after each read that changed the window, and after
 * a new header, display, sample or rate line.
 *
 * @param state - perf's state.
 * @param fn - The watch.
 * @returns The remover; a second call does nothing.
 */
export function watchTicks(state: PerfState, fn: () => void): () => void {
  const watcher = (): void => fn();
  state.watchers.add(watcher);
  return () => {
    state.watchers.delete(watcher);
  };
}

/**
 * Why the perf sources are not available: the game's off reason in words.
 *
 * @param state - perf's state.
 * @returns The reason; undefined when a monitor exists.
 */
export function offText(state: PerfState): string | undefined {
  if (state.off === "no-renderer") return "the game has no renderer (headless)";
  if (state.off === "no-monitor") {
    return "the engine has no renderer.monitor (needs @moku-labs/game with the block 2b monitor)";
  }
  return undefined;
}

/**
 * One perf source: `changes: "frame"`, watched through the read ticks, probed by `offText`.
 *
 * @param state - perf's state.
 * @param id - The source id.
 * @param title - The title.
 * @param input - The input schema.
 * @param read - The read: raw input to the wire value.
 * @returns The source entry.
 */
function perfSource(
  state: PerfState,
  id: string,
  title: string,
  input: InputSchema,
  read: (raw: Json) => Json
): SourceEntry {
  return {
    descriptor: { id, title, input, changes: "frame" },
    read,
    watch: (raw, fn) => watchTicks(state, () => fn(read(raw))),
    probe: () => offText(state)
  };
}

/**
 * Adds Mission control's four sources and the `editor.perf.sections` command (spec 03 Delta
 * 2026-10-16 D11): each read is the wire value of a value built at read time.
 *
 * @param registry - The registry API (`add`, `envelope`).
 * @param state - perf's state.
 */
function addMissionEntries(
  registry: Pick<RegistryApi, "add" | "envelope">,
  state: PerfState
): void {
  registry.add(
    perfSource(state, "editor.perf.frames", "Frames after a frame", AFTER_INPUT, raw =>
      toWireValue(framesWireOf(state, checkInput(AFTER_INPUT, raw).after))
    )
  );
  registry.add(
    perfSource(state, "editor.perf.events", "Timeline events", AFTER_INPUT, raw =>
      toWireValue(eventsWireOf(state, checkInput(AFTER_INPUT, raw).after))
    )
  );
  registry.add(
    perfSource(state, "editor.perf.passes", "GPU passes of a second", {}, () =>
      toWireValue(passesWireOf(state) ?? null)
    )
  );
  registry.add(
    perfSource(state, "editor.perf.detail", "Frames of a range", RANGE_INPUT, raw => {
      const { from, to } = checkInput(RANGE_INPUT, raw);
      return toWireValue(detailOf(state, from, to));
    })
  );
  registry.add({
    descriptor: {
      id: "editor.perf.sections",
      title: "Monitoring sections",
      input: SECTIONS_INPUT,
      effect: "cosmetic"
    },
    run: async raw => ({
      value: toWireValue(runSections(state, raw)),
      state: registry.envelope()
    })
  });
}

/**
 * Adds perf's sources and its command to the registry (perf's onInit).
 *
 * @param registry - The registry API (`add`, `envelope`).
 * @param state - perf's state.
 * @param config - perf's config.
 */
export function addPerfEntries(
  registry: Pick<RegistryApi, "add" | "envelope">,
  state: PerfState,
  config: Readonly<PerfConfig>
): void {
  registry.add(
    perfSource(state, "editor.perf.second", "Performance, this second", {}, () =>
      toWireValue(secondOf(state))
    )
  );
  registry.add(
    perfSource(state, "editor.perf.window", "Frame graph", {}, () =>
      toWireValue(writeWireWindow(state.window))
    )
  );
  registry.add(
    perfSource(state, "editor.perf.spikes", "Spikes of the graph", {}, () =>
      toWireValue(spikeSummaries(state, config))
    )
  );
  registry.add(
    perfSource(state, "editor.perf.spike", "Spike record", SPIKE_INPUT, raw => {
      const { frame } = checkInput(SPIKE_INPUT, raw);
      return toWireValue(spikeRecord(state, frame) ?? null);
    })
  );
  registry.add(
    perfSource(state, "editor.spikes", "Spikes", LAST_INPUT, raw => {
      const { lastMs } = checkInput(LAST_INPUT, raw);
      return toWireValue(spikeSummaries(state, config, lastMs === undefined ? {} : { lastMs }));
    })
  );
  addMissionEntries(registry, state);
}
