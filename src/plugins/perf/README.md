# perf

> Complex plugin (agent core). The performance **model** of the page agent: no DOM, no IO, no event of its own.

perf finds the engine's performance monitor (`app.renderer.monitor` of an agent build), reads its frame ring four
times a second into typed arrays allocated once, keeps the last `windowMs` (6 s) of frames as a struct-of-arrays
window, decides which frames are spikes and ranks their causes, and keeps the newest `header`, `sample`, `display`,
`rate`, `spike` and frame-event lines of the monitor's stream. It serves the overlay through its API and the tools
page and MCP through nine registry sources and one command (four sources and the command are Mission control's feeds,
below). Without a monitor (a headless game, an engine before block 2b) it is
"off": the API answers empty values with the reason and the sources are listed `available: false`.

## The spike rule

The engine sets a frame's `causes` bits; perf decides which frames are spikes (spec 03 delta 2026-10-15, items 7
and 8) and ranks their causes: gpu › upload › compile › longFrame › js › gc? › gap.

- **Work decides.** A frame is a spike only for its own work over its budget: JS, a sustained GPU, or a long
  animation frame. Upload and compile only name the work; a gap or the `gc?` hint alone is never a spike.
- **Rest.** Each row has a `rest` (`REST`): awake, idle (the engine's idle cap, or render on demand that drew
  nothing), the wake after a rest (keeps its work, not its gap; the first frame after a rest is the wake however
  long the engine slept), or a break (a workless gap of 900 ms or more while awake: the browser made no frame). Idle rows and breaks are never spikes; only awake rows and wakes count in the fps.
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
| `feedPasses` | `false` | boolean | Read the engine's pass ring and send the pass rows (the engine's default sections). |
| `feedSystems` | `true` | boolean | Read and send the top 5 systems of each frame. |
| `feedNodes` | `false` | boolean | Read and send the demand marks of each frame. |

```ts
createApp({ pluginConfigs: { registry: { game }, perf: { windowMs: 10_000, frames: 2048 } } });
```

A value out of range throws a `TypeError` at `createApp` (the state is checked before any array is sized):
`[moku-editor] perf.readEveryMs is 20.` / `  Give milliseconds from 50 to 1000; 250 reads four times a second.`
The feed switches are flat on purpose: per-plugin config merges shallowly, so a nested `feeds` object given by a
consumer would drop the switches it does not name. A switch that is not a boolean throws
`[moku-editor] perf.feedPasses is yes.` / `  Give true or false; false reads no passes.`

## API

`app.perf` or `ctx.require(perfPlugin)` gives `PerfApi` (contracts and examples on the type in `types.ts`).

| Member | Answers |
|---|---|
| `status()` | `{ state: "on", lost, gpuTimer }`, `{ state: "waiting" }` (a monitor with an empty ring) or `{ state: "off", reason }` (`"no-renderer"`, `"no-monitor"`). |
| `readWindow(visit)` | Calls `visit` once, synchronously, with perf's live window as a read-only `PerfWindowView`. Valid only inside `visit`: read it, never write it, never keep it. Allocation-free; a throwing visitor reaches the caller and changes nothing. |
| `second()` | The pill and the counters: fps of the window's last second, spikes, the newest frame's budget, the rate (`fps`, `mode`, `reason`, `displayHz`, `switches`), `activity` (rest now and since when, steady for the whole rest; idle frames and time; breaks; p90 of the awake frames, the last awake window's during a long rest), `gpuTime` (the window's GPU `p50Ms` and `p90Ms`, null without a GPU timer), `renderer.stats()` (`passesMax`, `kept`, `redraws`, `rebuilds`, null where the engine does not answer), the newest sample and the screen facts. Cached until the next read and frozen with its parts. |
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
| `editor.perf.frames` | `{ after: "number?" }` | `PerfFramesWire`: the rows after frame `after` (Mission control) |
| `editor.perf.events` | `{ after: "number?" }` | `PerfEventsWire`: the timeline marks from seq `after` (the last answer's `next`) on |
| `editor.perf.passes` | `{}` | `PerfPassesWire` of the newest full second, or `null` before one |
| `editor.perf.detail` | `{ from: "number", to: "number" }` | `PerfDetailWire` of a range |

The command `editor.perf.sections` (effect `cosmetic`, input any subset of `{ gpu, passes, shaders, problems, memory,
systems, nodes, longFrames }` as `"boolean?"`) switches perf's feeds and the engine's sections and answers
`PerfMonitorState` (below).

A watch is called after each read that changed the window and after a new header, display, sample or rate line,
always inside the monitor's agent span. Each watch is isolated: a throw is caught, the other watches still run, and
the first failure of a streak logs `perf:watcher-failed` at warn. A start whose first read throws leaves no stream
listener behind.

## Mission control's feeds (spec 03 Delta 2026-10-16)

The Render workspace of the tools page reads the same ids from whichever source it shows (the phone through the
bridge, the desktop preview in process). Every new engine field is optional: an engine without it answers "not
measured" (`null`, an absent block, a false capability), never 0.

- **Capabilities** (`second().caps`, `PerfCaps`): computed at the first read after a header (`capsOf`: each new ring
  column tested once by type and length, cached); a `shader`, `problem`, `gc` or `passes` line turns its capability on
  when it arrives. The tools page says "not measured on this engine" for a false one and "X is off" for a section
  switched off.
- **Frames feed** (`editor.perf.frames { after }`, `feeds/frames.ts`): the window rows with a frame after `after`
  (binary search), so each frame crosses the wire once; an `after` older than the frame before the window's oldest row
  (or past its newest: a reload) answers the whole window with `hole: true`. Blocks: `draws` when the ring counts
  them (absent on WebGL), `systems` (names, then rows × 5 indexes and ms) with `feedSystems` and the ring's system
  names, `nodes` (−1: not read) with `feedNodes`, `passes` with `feedPasses`; a block whose engine section is off is
  absent. The system names are copied only when the ring's names grow: by a new array (the 0.15.x patch) or in place
  (0.15.0); one check per read covers both.
- **Pass window** (`feeds/passes.ts`): the engine's pass ring copied with perf's own cursor inside the read's agent
  span (allocation-free), `frames × 4` rows, passes of frames the window holds only (a pass of a frame not read yet
  waits for it), trimmed with the window, a late pass GPU taken from its own slot only, overwritten passes counted
  as `lost`. A switch-on starts at the ring's oldest held pass inside the window. The pass `kind` byte decodes with
  `PASS_KINDS` (`ring.ts`); a filter's name is `kindNames[kind2 − 1]` (0: none).
- **Passes of a second** (`editor.perf.passes`): raw (owner 2026-10-16). The pass rows of the newest whole second of
  the page clock the window covers and its heaviest drawn frame (`source: "agent"`), or the engine's `passes` line
  passed on as it came (`source: "engine"`, next change: nothing more is read of it on the phone, TODO(engine)); the
  tile-GPU flag, `targets` and `shaders` of the newest sample. The tools page builds the filter chains and the heaviest
  frame's GPU shares with `passesSummaryOf` (`protocol/passes.ts`); `appendSecond` keeps that summary.
- **Timeline** (`editor.perf.events { after }`, `feeds/timeline.ts`): `rate`, `shader`, `gc`, `problem`, `sections`,
  `pool-trim`, `recorder` and `mark` lines kept by reference in a ring of 256 with a seq; a `display` line only when
  its rate changed; an old engine's `compile` line only until a `shader` line came. The answer sends the kept lines
  themselves with their seq from `after` (the previous answer's `next`) on, and `timeOrigin` once, and says `lost`
  when more than 256 passed (owner 2026-10-16). The tools page builds the marks with `eventsOf` (`timelineEventOf` on
  each, page clock); `appendEvents` does it for the history.
- **Range detail** (`editor.perf.detail { from, to }`, `feeds/detail.ts`): at most the newest 2048 frames; perf's
  window rows of the range with `reason: "no-detail"`; else `frames: null`, `reason: "gone"`. Reading the engine's
  `monitor.detail` (next change; the reasons `control` and `failed`) is deferred until the engine ships it
  (owner 2026-10-16, TODO(engine)): perf does not call it yet.
- **Monitoring** (`editor.perf.sections`, `second().monitor`, `feeds/sections.ts`): the engine's sections as last
  heard (header, a read at start, `sections` lines, a write's answer; the defaults with `engine: false` on an engine
  without `monitor.sections`), perf's feeds, the cost per section and `monitorMs` of the newest sample, perf's own
  read time per second (`editorMs`, an EMA timed around each read), and the overdraw switch (header `debug`, `debug`
  lines). A write the build refuses (`reason: "read-only"` / `"dev-only"`) is the registry's -32009 (`read_only` /
  `dev_only`), after perf's feeds switched.
- **Memory trust** (`second().memory`, `feeds/memory.ts`): the newest sample's heap is never trusted in a WebView
  (frozen on Android, the A26 finding), nor after 20 equal samples while the page was awake (a frozen counter), and
  is "not measured" without a number (iOS). The phone's Memory card comes from the computer (connect), not from perf.
- `second()` also carries `epoch` (the page's `timeOrigin` as text: a new one is a reload), `counts` (the sample's
  object counters, engine U3) and `appId` (`header.app.id`).

**What runs where (owner 2026-10-16).** The phone does the reading only: the frames feed, the raw timeline lines and the
raw pass rows. Marks (`eventsOf`), pass chains and shares (`passesSummaryOf`) and the history are the tools page's,
which keeps the agent under its bundle bound: 124 000 B gzip for the dev agent (`tests/integration/agent-bundle.test.ts`,
spec 10); at the raise it measured 122 121 B (dev) and 123 206 B (debug page).

**The 2-minute history lives on the tools page** (`protocol/history.ts`, filled by renderView): the engine ring holds
about 8 s and a 2-minute device-side copy would cost the phone megabytes in a page whose memory it cannot even
measure; pause and rewind are a view of the tools page; a disconnect must not lose what was seen; and the frames feed
already sends each frame once. A link stall longer than the window leaves a hole the feed reports.

| Engine field | Engine version | Without it |
|---|---|---|
| pass ring `owner`, `kind2` (named by the frame ring's `kindNames`), `drawsAt`, `format`, `resolution`; `shader` lines; sample `targets`, `counts`; header `app.id`, `debug.overdraw`; `problem` lines (`filter-still`, `target-churn`, `retakes`) | 0.15.1 (the 0.15.x patch, the dev engine) | owner, filter, draws, format, resolution null; old `compile` lines as compiles without ms; `targets`, `counts`, `appId` null. Draws also need `draws` in the header's `measured`: the engine counts them on WebGPU only and writes `drawsAt` 0 on WebGL |
| `ring.systemNames` public, copied on growth | 0.15.1 (present, grown in place, in 0.15.0) | the names copied when their length grows |
| `monitor.sections`, `sections` lines, header `sections`, sample `sectionsMs` | next change | perf's feeds only, `engine: false`, `costMs` null |
| `monitor.detail`, the mark ring | next change (perf's reading deferred) | perf's window, `nodes` null |
| `passes` summary line, sample `shaders`, `gc` lines, sample `memory` | next change | perf's raw pass rows (chains built on the tools page); `shaders` null; no GC marks; `source` inferred (`memory.source`, `"uasm"` included, passed through when sent) |

## The read cycle

`readTick` runs on perf's own timer, never inside a frame, between `monitor.beginAgent()` and `endAgent()` (the end
also when the read throws), so perf never makes the spike it measures. It reads only the frames after its cursor
(the first read of a run does not count older frames as lost), appends them (a full window drops its oldest
quarter), trims rows older than `windowMs`, picks up late GPU times from the same ring slot while the slot still
holds the frame, counts the sustained GPU, rebuilds the spike index, the headline GPU and the scalars, and moves
`version` (and tells the watches) only when something changed. The frame time of a row is `max(gap, js + gpu)`, its
JS time `workMs − agentMs`. With Mission control it also computes the capabilities after a new header, copies the
feeds' columns (draws always, the systems and the marks only while their feeds are on: four read targets made once),
reads the pass ring and times itself (`editorMs`). It allocates nothing: indexed loops, typed-array `copyWithin` and
an in-place sort (`memory.test.ts` runs it 20 000 frames with every feed on and 8 passes a frame).

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
  a span that is not finite or outside 0 < span ≤ 60 s (a window without rows may span 0: perf's own value while it
  waits for the monitor's first frame) and a `rateMs` outside (0, 1000], and drops cause bits it
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
  - `nowMs` — the plot's right edge in page-clock ms, for interpolated drawing: the axis runs to it and only rows
    inside the span are drawn. Past the newest row, that row ends at its own end; before it, the rows it has not
    reached are held back (no bar, flag or cursor, and no hit) and the row it is inside of is cut at the plot's
    right edge. The window's `endMs` by default.
  - `spanMs` — the time the plot spans under a `nowMs` (the tools strip cuts its playout delay off the window's
    span). The window's span by default; the wide axis puts each second at its own time.
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
| `depends` | `registryPlugin` | `game()` in `onInit` (the monitor and the renderer are read from the game app), `add` of the nine sources and the command, `envelope()` of the command's answer |
| events | none | perf emits and hooks nothing; the overlay and the recorder call its API |
| protocol | `./protocol` (`perf/protocol`) | the engine view, the cause ranking, the window and its wire form, the values, the guards |
| protocol | `../registry/protocol` | `checkInput`, `toWireValue`, `wireError` and `errorCode` (the sections refusal), the `InputSchema` / `Json` types |

perf imports the engine by type (`import type` in `protocol/engine.ts`) and, in `ring.ts` only, the two plain lists
`PERF_CAUSES` and `DEMAND_REASONS` at run time, on the agent side (the game's page has the engine already); the
runtime-free modules and the tools and server bundles get no engine code. It never imports the recorder, the
overlay, the bridge or `hub/protocol`.

## Lifecycle

| Phase | What |
|---|---|
| `createState` | Checks the config (a `TypeError` at `createApp`) and allocates every typed array once: the window of `frames` rows and the read scratch. |
| `onInit` | Reads the game from the registry, finds `app.renderer.monitor` (`monitorOf`) or the off reason (`offReasonOf`: `no-renderer`, `no-monitor`), adds the nine sources and the command, and logs `perf:off` at info when off. |
| `onStart` | Without a monitor: nothing. Otherwise subscribes to `monitor.stream`, reads the engine's sections once (an engine with `monitor.sections`), runs the first read (a throw unsubscribes and fails the start, no timer is left), then starts the read timer every `readEveryMs`; logs `perf:started` at debug. |
| `onStop` | Clears the timer, unsubscribes the stream, drops the watches and the cursors, empties the window and the pass window (the window's `version` moves, so a painter repaints an empty graph), lets go of the kept timeline lines (the seq goes on) and computes the capabilities again at the next start. Emits and logs nothing. |

## Files

| File | Role |
|---|---|
| `index.ts` | Wiring: depends, config, state, api, lifecycle. |
| `types.ts` | Config, state, scratch, ctx, the API (contracts and examples on its members); re-exports the `perf/protocol` types for `Perf.*`. |
| `state.ts` | The config check and `createPerfState`: every array allocated once; the watch notify. |
| `api.ts` | `createPerfApi`: thin calls into `records.ts`, the window visitor, `monitor()`. |
| `lifecycle.ts` | `initPerf`, `startPerf`, `stopPerf`. |
| `reader.ts` | `readTick`: the read cycle inside the monitor's agent span; allocation-free. |
| `ring.ts` | The ring's decoding with the engine's `PERF_CAUSES` and `DEMAND_REASONS` (`ringCauses`, `REASON_NONE`) and the pass kind byte (`passKindOf`); the only run-time engine import. |
| `stream.ts` | The `monitor.stream` listener: the newest header, display (and the hz it announces) and sample, the last 64 spike lines, 16 `rate` lines, 32 frame-event lines and 2 `passes` lines, the timeline's lines, the sections and the overdraw switch. |
| `records.ts` | The values handed out: `status`, `second()` (frozen), the spike summaries, the spike record and its `why`. |
| `entries.ts` | The nine registry sources and the `editor.perf.sections` command, their probes and watches. |
| `feeds/` | Mission control on the agent: `caps.ts`, `passes.ts` (the pass window, `editor.perf.passes`), `frames.ts`, `timeline.ts`, `detail.ts`, `sections.ts`, `memory.ts`, `wire.ts` (rounding, epoch), `index.ts`. |
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
| The frames feed | The window only: a reader that falls behind it gets `hole: true`. A late GPU time that lands after a frame was sent does not reach the reader. |
| The timeline | The newest 256 kept lines; an older `after` answers `lost: true`. |
| The pass window | `frames × 4` passes, the passes of the frames the window holds; read only while `feedPasses` is on. |


## Why perf and recorder are two plugins

perf is a **read model**: it keeps the last 6 s in typed arrays allocated once, answers the overlay and the sources,
and forgets everything older; it owns no IO and no timer but its 4 Hz read. The recorder is a **persistence and
outbox pipeline**: it keeps every line of the stream for hours, serializes on its own timer, writes OPFS chunks,
shares files and holds the unconfirmed lines the bridge ships. They change for different reasons (a graph rule vs a
storage or wire rule), fail in different ways (a missed paint vs a lost log) and are tested apart. The bridge depends
on the recorder alone, never on perf; the recorder reaches the monitor through `perf.monitor()` only.
