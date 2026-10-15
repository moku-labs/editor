# perf

> Complex plugin (agent core). The performance **model** of the page agent: no DOM, no IO, no event of its own.

perf finds the engine's performance monitor (`app.renderer.monitor` of an agent build), reads its frame ring four
times a second into typed arrays allocated once, keeps the last `windowMs` (6 s) of frames as a struct-of-arrays
window, ranks the causes of every spike the engine flagged, and keeps the newest `header`, `sample`, `display`,
`rate`, `spike` and frame-event lines of the monitor's stream. It serves the overlay through its API and the tools
page and MCP through five registry sources. Without a monitor (a headless game, an engine before block 2b) it is
"off": the API answers empty values with the reason and the sources are listed `available: false`.

perf never classifies a frame: whether a frame is a spike and why is the engine's (`causes` bits). perf only ranks
the causes: gpu › upload › compile › longFrame › js › gc? › gap.

## Configuration

| Option | Default | Range | Meaning |
|---|---|---|---|
| `readEveryMs` | `250` | 50 to 1000 | How often perf reads the ring (4 Hz). |
| `windowMs` | `6000` | 1000 to 30000 | The window the graph, the spike index and every spike count cover. |
| `frames` | `1024` | whole, 64 to 16384 | Rows perf keeps: at least `windowMs` at 120 Hz (720). |

```ts
createApp({ pluginConfigs: { registry: { game }, perf: { windowMs: 10_000, frames: 2048 } } });
```

A value out of range throws a `TypeError` at `createApp` (the state is checked before any array is sized):
`[moku-editor] perf.readEveryMs is 20.` / `  Give milliseconds from 50 to 1000; 250 reads four times a second.`

## API

`app.perf` or `ctx.require(perfPlugin)` gives `PerfApi` (contracts and examples on the type in `types.ts`).

| Member | Answers |
|---|---|
| `status()` | `{ state: "on", lost, gpuTimer }`, `{ state: "waiting" }` (a monitor with an empty ring) or `{ state: "off", reason }` (`"no-renderer"`, `"no-monitor"`). |
| `readWindow(visit)` | Calls `visit` once, synchronously, with perf's live window as a read-only `PerfWindowView`. Valid only inside `visit`: read it, never write it, never keep it. Allocation-free; a throwing visitor reaches the caller and changes nothing. |
| `second()` | The pill and the counters: fps of the window's last second, spikes, the newest frame's budget, the rate (`fps`, `mode`, `reason`, `displayHz`, `switches`), `renderer.stats()` (`passesMax`, `kept`, `redraws`, `rebuilds`, null where the engine does not answer), the newest sample and the screen facts. Cached until the next read and frozen with its parts. |
| `spikes({ lastMs? })` | The spikes of the window, oldest first, each with its primary cause and a one-line `why`. |
| `spike(frame)` | The record of one spike: the ring's numbers (or the engine spike line's once the slot was overwritten), the rate switch, the game's frame events (`overlay`, `warm` of the frame, `pool-trim` of the frame or the one before) and the spike line as `detail` once it arrived. |
| `monitor()` | The monitor, for the recorder; `undefined` while off. |

```ts
const paintVisitor = (window: PerfWindowView): void => {
  if (window.version !== painted) paintGraph(g, window, view, graphState);
};
app.perf.readWindow(paintVisitor); // the visitor is made once per mount, never per tick
app.perf.spike(4812)?.why; // "41.0 MB of textures uploaded this frame (bundle garden-boss)"
```

## Registry sources

Added in `onInit` through `registry.add`, all `changes: "frame"`; each has a probe, so without a monitor they are
listed `available: false` with the reason and their reads answer -32008.

| Id | Input | Value |
|---|---|---|
| `editor.perf.second` | `{}` | `PerfSecond` |
| `editor.perf.window` | `{}` | `PerfWindowWire` (`writeWireWindow`) |
| `editor.perf.spikes` | `{}` | `PerfSpikeSummary[]` of the whole window |
| `editor.perf.spike` | `{ frame: "number" }` | `PerfSpikeRecord` or `null` |
| `editor.spikes` | `{ lastMs: "number?" }` | the MCP mirror of `perf.spikes({ lastMs })` |

A watch is called after each read that changed the window and after a new header, display, sample or rate line,
always inside the monitor's agent span. Each watch is isolated: a throw is caught, the other watches still run, and
the first failure of a streak logs `perf:watcher-failed` at warn. A start whose first read throws leaves no stream
listener behind.

## The read cycle

`readTick` runs on perf's own timer, never inside a frame, between `monitor.beginAgent()` and `endAgent()` (the end
also when the read throws), so perf never makes the spike it measures. It reads only the frames after its cursor
(the first read of a run does not count older frames as lost), appends them (a full window drops its oldest
quarter), trims rows older than `windowMs`, picks up late GPU times from the same ring slot while the slot still
holds the frame, rebuilds the spike index and the scalars, and moves `version` (and tells the watches) only when
something changed. The frame time of a row is `max(gap, js + gpu)`, its JS time `workMs − agentMs`. It allocates
nothing: indexed loops and typed-array `copyWithin`.

## The per-frame budget

The engine writes, per frame, the budget its spike rule used (`budgetMs` column: one frame of the frame's rate under
`renderer.monitor.budgetMs: "rate"`, the fixed number otherwise) and the rate (`rateMs`). perf copies both into every
row: the graph's budget line steps with `budgetMs`, its rate-switch marks follow `rateMs`, and a spike's `budgetMs`
and `overMs` are its own row's. A ring without the `budgetMs` column falls back to the row's `rateMs`.

## The runtime-free modules

- **`perf/protocol/`** — the editor's view of the engine (`engine.ts`), the cause ranking (`causes.ts`), `rateFps`,
  `cleanText`, the window and its wire form (`window.ts`: `createPerfWindow`, `rowOfFrame`, `stepSpike`,
  `spikeOrdinal`, `meanGpu`, `writeWireWindow`, `readWireWindow`), the source values (`values.ts`) and the guards perf
  reads the engine through (`guards.ts`). It imports its own files, `registry/protocol` by type and the engine by
  type only, never `hub/protocol` (`protocol-boundary.test.ts`). `readWireWindow` refuses a value of another shape,
  a span that is not finite or outside 0 < span ≤ 60 s and a `rateMs` outside (0, 1000], and drops cause bits it
  does not know.
- **`perf/graph/`** — the pure canvas-2D painter of the frame graph on the structural `GraphContext2D`
  (`paintGraph`, `createGraphState`, `resetGraphText`, `spikeAt`, `rowAt`, `CAUSE_STYLE`). No DOM type, no Preact,
  no allocation per paint; at most 60 axis labels; rate labels only for 1 to 1000 fps, at most 16 cached
  (`graph-boundary.test.ts`). Used by the overlay and the tools strip.

## The engine types and their contract test

`protocol/engine.ts` re-exports every type the engine exports with the shape the editor reads (`FrameRing`,
`FrameColumns`, the log lines, `PerfCause`, `PerfChange`, `PerfDisplay`, `ThermalReading`, …) with `export type`, so
no engine code enters a bundle. Where a later engine spec adds fields (the header's `rate`, the sample's and the
frame record's `kept`, the `pool-trim` and `warm` event names, the `kept` measure), the type is the engine's with the
addition; where the engine has no type yet (spec 21 rate types, spec 22 overlay detail, spec 23 `KeptStats`, spec 25
and 27 details, `RenderStatsLike`, `MonitorLike`), a structural copy. `engine-contract.test.ts` checks every engine
line against the editor's union both ways, the additions and the pending fields, and the editor constants
(`PERF_LOG_VERSION`, `PERF_GAP_BUCKETS`, `PHASES`, `CAUSE_BITS`, the change order) against the engine's exports and
its own `frameAt`. The integration test `engine.test.ts` runs perf on a real engine game with the agent flag on.

## Why perf and recorder are two plugins

perf is a **read model**: it keeps the last 6 s in typed arrays allocated once, answers the overlay and the sources,
and forgets everything older; it owns no IO and no timer but its 4 Hz read. The recorder is a **persistence and
outbox pipeline**: it keeps every line of the stream for hours, serializes on its own timer, writes OPFS chunks,
shares files and holds the unconfirmed lines the bridge ships. They change for different reasons (a graph rule vs a
storage or wire rule), fail in different ways (a missed paint vs a lost log) and are tested apart. The bridge depends
on the recorder alone, never on perf; the recorder reaches the monitor through `perf.monitor()` only.
