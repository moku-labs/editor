# perf

> Complex plugin (agent core). The performance **model** of the page agent: no DOM, no IO, no event of its own.

perf finds the engine's performance monitor (`app.renderer.monitor` of an agent build), reads its frame ring four
times a second into typed arrays allocated once, keeps the last `windowMs` (6 s) of frames as a struct-of-arrays
window, decides which frames are spikes and ranks their causes, and keeps the newest `header`, `sample`, `display`,
`rate`, `spike` and frame-event lines of the monitor's stream. It serves the overlay through its API and the tools
page and MCP through five registry sources. Without a monitor (a headless game, an engine before block 2b) it is
"off": the API answers empty values with the reason and the sources are listed `available: false`.

## The spike rule

The engine sets a frame's `causes` bits; perf decides which frames are spikes (spec 03 delta 2026-10-15, items 7
and 8) and ranks their causes: gpu › upload › compile › longFrame › js › gc? › gap.

- **Work decides.** A frame is a spike only for its own work over its budget: JS, a sustained GPU, or a long
  animation frame. Upload and compile only name the work; a gap or the `gc?` hint alone is never a spike.
- **Rest.** Each row has a `rest` (`REST`): awake, idle (the engine's idle cap, or render on demand that drew
  nothing), the wake after a rest (keeps its work, not its gap), or a break (a workless gap of 900 ms or more: the
  browser made no frame). Idle rows and breaks are never spikes; only awake rows and wakes count in the fps.
- **Vsync.** A gap counts only beyond 1.5 × max(budget, 1000 / display Hz): the gap bit of a shorter one is cleared.
  The display Hz is the `hz` the display announces (`PerfDisplay.hz` in the header and in each `display` event, one
  of which follows when the engine learns the panel's rate), else `time.rate().displayHz` (an older log).
- **The engine's input.** Since game@0fda201 the engine's own gap bit is cleaner (budget = max(rate, display), no gap
  on hidden or throttled pages or between two undrawn frames, the wake judged against the previous cap, `gc?` only
  for gapMs − agentMs ≤ 500); perf keeps its rules above on top of it.
- **GPU noise.** One frame's `gpuMs` is noisy on Apple and Mali (17–25 ms readings at a 0.49 ms p50; results up to
  ~1 s late). A GPU over budget counts only when sustained: on 2 of 3 consecutive drawn frames, both frames. Until
  then it waits in the window's `noise` column (`GPU_BIT`, `isGpuNoise`): a faint GPU tick, not a spike. A late
  result decides when it lands, and the second over-budget result promotes the first; a counted GPU stays counted.
  The headline GPU is the window's p50 and p90 (`gpuP50Ms`, `gpuP90Ms`; `second().gpuTime`), never one frame's.

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
| `second()` | The pill and the counters: fps of the window's last second, spikes, the newest frame's budget, the rate (`fps`, `mode`, `reason`, `displayHz`, `switches`), `activity` (rest now and since when, idle frames and time, breaks, p90 of the awake frames), `gpuTime` (the window's GPU `p50Ms` and `p90Ms`, null without a GPU timer), `renderer.stats()` (`passesMax`, `kept`, `redraws`, `rebuilds`, null where the engine does not answer), the newest sample and the screen facts. Cached until the next read and frozen with its parts. |
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
holds the frame, counts the sustained GPU, rebuilds the spike index, the headline GPU and the scalars, and moves
`version` (and tells the watches) only when something changed. The frame time of a row is `max(gap, js + gpu)`, its
JS time `workMs − agentMs`. It allocates nothing: indexed loops, typed-array `copyWithin` and an in-place sort.

The ring is decoded with the engine's own lists, root exports since game@0fda201 (`ring.ts`): the `causes` bits by
name through `PERF_CAUSES` into the window's bit order (a 256-entry table built once; a bit the engine does not name
is dropped), and the draw reason "none" as `DEMAND_REASONS.indexOf("none")`. `ring.ts` is the editor's only run-time
import of the engine: perf's agent side runs in the game's page, where the engine is loaded already, and no
runtime-free module or other plugin imports it (`ring-boundary.test.ts`), so the tools and server bundles get no
engine code.

## The per-frame budget

The engine writes, per frame, the budget its spike rule used (`budgetMs` column: one frame of the frame's rate under
`renderer.monitor.budgetMs: "rate"`, the fixed number otherwise) and the rate (`rateMs`). perf copies both into every
row: the graph's budget line steps with `budgetMs`, its rate-switch marks follow `rateMs`, and a spike's `budgetMs`
and `overMs` are its own row's. A ring without the `budgetMs` column falls back to the row's `rateMs`.

## The runtime-free modules

- **`perf/protocol/`** — the editor's view of the engine (`engine.ts`), the cause ranking and the spike rule
  (`causes.ts`), the GPU noise rule and the headline GPU (`gpu.ts`: `GPU_BIT`, `isGpuNoise`, `promoteSustainedGpu`,
  `spreadGpu`), `rateFps`, `cleanText`, the window and its wire form (`window.ts`: `createPerfWindow`, `rowOfFrame`,
  `stepSpike`, `spikeOrdinal`, `meanGpu`, `writeWireWindow`, `readWireWindow`; optional `rest` and `noise` columns),
  the source values (`values.ts`) and the guards perf reads the engine through (`guards.ts`). It imports its own files, `registry/protocol` by type and the engine by
  type only, never `hub/protocol` (`protocol-boundary.test.ts`). `readWireWindow` refuses a value of another shape,
  a span that is not finite or outside 0 < span ≤ 60 s and a `rateMs` outside (0, 1000], and drops cause bits it
  does not know.
- **`perf/graph/`** — the pure canvas-2D painter of the frame graph on the structural `GraphContext2D`
  (`paintGraph`, `msToPx`, `createGraphState`, `resetGraphText`, `spikeAt`, `rowAt`, `CAUSE_STYLE`,
  `GRAPH_COLOURS`, `GRAPH_FONTS`). No DOM type, no Preact, no allocation per paint; at most 60 axis labels; rate
  labels only for 1 to 1000 fps, at most 16 cached (`graph-boundary.test.ts`). Used by the overlay and the tools
  strip. `GraphView` options beside `width`, `height`, `wide` and `selected`:
  - `look` — the colours, cause hues and fonts (`GraphLook`); the overlay's glass cockpit by default. A look with
    another `key` resets the state's text cache.
  - `layer` — the part to paint: `"all"` (default); `"plot"` (what is tied to time: rows, budget lines, flags, the
    axis's seconds) and `"fixed"` (the tape and its readout, the caption, `now`, the stack legend, on a transparent
    ground) for a sliding canvas under a still one; `"base"` (the well, the grid, the tape's ground, spine and ticks)
    for an offscreen canvas redrawn on a size, look or scale change, and `"over"` (everything else) painted over it.
  - `nowMs` — the plot's right edge in page-clock ms, for interpolated drawing: the axis runs to it, the newest row
    ends at its own end, only rows inside the span are drawn. The window's `endMs` by default.
  - `leadPx` — CSS px of plot past the visible right edge, for a canvas wider than its well slid by a compositor
    transition: the time scale is the one of `width − leadPx`, `now` and the left-anchored texts move by it.

  The painter draws the rules above: a lone GPU outlier (`isGpuNoise`) as a faint tick in the GPU colour under the
  baseline, its GPU time left out of the bar; an awake row's notable gap as a faint tick in the idle outline; a resting
  row as one quiet frame of its rate; a break as a cut in the baseline with a double bar. The tools page's light and
  dark looks are `graph/themes.ts` (`graphLook`, `GRAPH_LIGHT`, `GRAPH_DARK`, `GRAPH_PALETTES`, `causeHue`,
  `TOOLS_FONTS`), imported by path by the tools page only and kept out of the barrel, so the agent bundle never
  carries them.

## The engine types and their contract test

`protocol/engine.ts` re-exports every engine type perf and its readers use, with `export type` so no
engine code enters a bundle: the frame ring and its columns, the log lines and their union, the event
names and the details of the game's frame events (`OverlayWhat`, `OverlayEventDetail`,
`PoolTrimDetail`, `WarmDetail`), the spec 21 rate types from `Time`, and `KeptStats`, the render
stats and the monitor (`MonitorLike` is `Renderer.PerfMonitorApi`) from `Renderer`. The only editor
type left is `DevtoolsDetail`: the engine lists the editor's `devtools` event name but leaves its
detail to the editor. `engine-contract.test.ts` asserts every re-export equals the engine's type and
checks the editor constants (`PERF_LOG_VERSION`, `PERF_GAP_BUCKETS`, `PHASES`, the change order) against the
engine's exports and its own `frameAt`. `CAUSE_BITS`, the engine-free bit order of the window, the wire, the tools
page and the server's report, must equal the engine's `PERF_CAUSES`; the fake ring's `reason` column decodes with
the engine's `DEMAND_REASONS`. The integration test `engine.test.ts` runs perf on a real engine game with the agent
flag on.

## Dependencies

| Kind | Name | Used for |
|---|---|---|
| `depends` | `registryPlugin` | `game()` in `onInit` (the monitor and the renderer are read from the game app), `add` of the five sources |
| events | none | perf emits and hooks nothing; the overlay and the recorder call its API |
| protocol | `./protocol` (`perf/protocol`) | the engine view, the cause ranking, the window and its wire form, the values, the guards |
| protocol | `../registry/protocol` | `checkInput`, `toWireValue` and the `InputSchema` / `Json` types of the sources |

perf imports the engine by type (`import type` in `protocol/engine.ts`) and, in `ring.ts` only, the two plain lists
`PERF_CAUSES` and `DEMAND_REASONS` at run time, on the agent side (the game's page has the engine already); the
runtime-free modules and the tools and server bundles get no engine code. It never imports the recorder, the
overlay, the bridge or `hub/protocol`.

## Lifecycle

| Phase | What |
|---|---|
| `createState` | Checks the config (a `TypeError` at `createApp`) and allocates every typed array once: the window of `frames` rows and the read scratch. |
| `onInit` | Reads the game from the registry, finds `app.renderer.monitor` (`monitorOf`) or the off reason (`offReasonOf`: `no-renderer`, `no-monitor`), adds the five sources, and logs `perf:off` at info when off. |
| `onStart` | Without a monitor: nothing. Otherwise subscribes to `monitor.stream`, runs the first read (a throw unsubscribes and fails the start, no timer is left), then starts the read timer every `readEveryMs`; logs `perf:started` at debug. |
| `onStop` | Clears the timer, unsubscribes the stream, drops the watches and the cursor, and empties the window (its `version` moves, so a painter repaints an empty graph). Emits and logs nothing. |

## Files

| File | Role |
|---|---|
| `index.ts` | Wiring: depends, config, state, api, lifecycle. |
| `types.ts` | Config, state, scratch, ctx, the API (contracts and examples on its members); re-exports the `perf/protocol` types for `Perf.*`. |
| `state.ts` | The config check and `createPerfState`: every array allocated once; the watch notify. |
| `api.ts` | `createPerfApi`: thin calls into `records.ts`, the window visitor, `monitor()`. |
| `lifecycle.ts` | `initPerf`, `startPerf`, `stopPerf`. |
| `reader.ts` | `readTick`: the read cycle inside the monitor's agent span; allocation-free. |
| `ring.ts` | The ring's decoding with the engine's `PERF_CAUSES` and `DEMAND_REASONS` (`ringCauses`, `REASON_NONE`); the only run-time engine import. |
| `stream.ts` | The `monitor.stream` listener: the newest header, display (and the hz it announces) and sample, the last 64 spike lines, 16 `rate` lines and 32 frame-event lines. |
| `records.ts` | The values handed out: `status`, `second()` (frozen), the spike summaries, the spike record and its `why`. |
| `entries.ts` | The five registry sources, their probes and watches. |
| `protocol/` | Runtime-free: `engine.ts`, `causes.ts`, `gpu.ts`, `rate.ts`, `text.ts`, `values.ts`, `window.ts`, `guards.ts`, `index.ts`. |
| `graph/` | Runtime-free, DOM-free canvas painter: `paint.ts`, `geometry.ts`, `labels.ts`, `hit.ts`, `palette.ts`, `state.ts`, `types.ts`, `index.ts`; `themes.ts` (the tools page's looks) outside the barrel. |

## Limits

| Missing or bounded | What perf does |
|---|---|
| A renderer or its monitor (a headless game, an engine before block 2b) | Off: `status()` answers the reason, the reads answer empty values, the sources are listed `available: false` (-32008); the overlay's Frames tab says why. |
| A GPU timer (WebKit; `header.gpu.timer` null) | `gpuTimer: false`: GPU times stay "not measured", the graph stacks JS and idle only, and a gap spike's `why` adds that a busy GPU also reads as a gap. |
| The ring's `budgetMs` column (an engine before the addendum) | The row's `rateMs` is its budget. |
| A spike whose ring slot was overwritten | Its numbers come from the engine's spike line, once that line arrived. |
| Late GPU times | Picked up only while the ring slot still holds the frame. A GPU outlier whose partner frame already left the window stays noise. |
| A display Hz (`hz` null until the engine learns it; absent from an older log) | `time.rate().displayHz`, else the header's or newest rate line's; null while none is known (a gap is then judged on the budget alone). |
| A wire window without `rest` or `noise` (an agent before the delta) | Every row awake; no noise, the agent's causes as sent. |
| Lines kept | The last 64 spike lines, 16 `rate` lines and 32 frame-event lines; the window covers `windowMs` (at most 30 s). The recorder keeps the whole stream. |
| `renderer.stats()` fields the engine does not answer (a release build without them) | `null` in `second().render` (`passesMax`, `kept`, `redraws`, `rebuilds`). |


## Why perf and recorder are two plugins

perf is a **read model**: it keeps the last 6 s in typed arrays allocated once, answers the overlay and the sources,
and forgets everything older; it owns no IO and no timer but its 4 Hz read. The recorder is a **persistence and
outbox pipeline**: it keeps every line of the stream for hours, serializes on its own timer, writes OPFS chunks,
shares files and holds the unconfirmed lines the bridge ships. They change for different reasons (a graph rule vs a
storage or wire rule), fail in different ways (a missed paint vs a lost log) and are tested apart. The bridge depends
on the recorder alone, never on perf; the recorder reaches the monitor through `perf.monitor()` only.
