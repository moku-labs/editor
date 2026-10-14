# collector

> Complex plugin (server core): device performance logs on the computer.

`collector` is a default server plugin that does nothing until device mode turns on (the hub's
per-plugin event `hub:device`, kind `listening`). Then it keeps the phones' performance logs on the
computer:

- **One JSONL file per device log** (`perf-<yyyymmdd-hhmm>-<model>.jsonl` under `out`). Every line the
  hub hands over is appended with `rx` (computer epoch ms at receipt). A phone that reconnects with its
  token appends to the same file, so a Wi-Fi drop no longer splits or loses a recording. Batches are
  written in arrival order: the hook enqueues synchronously, each log has one write queue.
- **adb, only while device mode is on.** Every `reverseEveryMs` (2 s): `adb devices` and
  `adb -s <serial> reverse tcp:<port> tcp:<port>` for every ready phone, so a phone plugged in later is
  reached without a restart. The model comes from `adb shell getprop ro.product.model`, normalized
  like the page's header (`normalizeModel` of `hub/protocol`). Every `everyS` seconds, for each adb
  phone matched to exactly one live adb log: `dumpsys battery` + `dumpsys thermalservice` (a `thermal`
  line, `source: "collector"`) and `dumpsys gfxinfo <package>` (a `gfx` line from the second reading
  on). Reads only; nothing on the phone changes except the port reverse.
- **One clock.** Collector lines carry `t` on the phone's page clock (`now + offset`, the offset being
  the max of `t − rx` over the log's device lines) and `rx` on the computer clock, so device and
  computer lines sort on one timeline.
- **Never silent about loss.** A device gap (lines it lost before sending) becomes one `gap` line
  before the batch; gaps, rejected lines and failed writes are counted as `lost` (one
  `collector:write-failed` warning per failing streak).
- **`collector:session`**, its per-plugin event, at most once a second per log, for the CLI's live line.
- **The computer mark**: `app.collector.mark(label)` and the route `{path}/perf/mark`.
- **`report/`**: the runtime-free log report (parse, summary per screen and rate, compare, text).

## Configuration

Set through `pluginConfigs.collector`. Checked in `onInit`; a bad field throws a `TypeError` in the
two-line format.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `out` | `string` | `".moku/perf"` | Folder of the logs: relative to the files root, or absolute. Created on the first log. Non-empty. |
| `everyS` | `number` | `10` | Seconds between two adb readings (heat, system frames) of a phone. Whole number, 1–3600. |
| `reverseEveryMs` | `number` | `2000` | Milliseconds between two `adb devices` + `adb reverse` rounds. Whole number, ≥ 500. |
| `adb` | `string` | `"adb"` | The adb command (a name on PATH or a path). Non-empty. |
| `adbTimeoutMs` | `number` | `5000` | The longest one adb command may run before it is killed. Whole number, ≥ 500. |
| `appId` | `string \| undefined` | `undefined` | The game's Android package. `<appId>.debug` is preferred when installed. Undefined: no gfx lines. |

```
[moku-editor] collector.everyS is 0.
  Use whole seconds from 1 to 3600, for example 10.
```

## API

### `sessions(): CollectorSessionInfo[]`

Every device log of this run, oldest first, as fresh copies: `{ device, log, file, state, lines,
lost, last, stopTimedOut }`. `state` is `live` (the phone is connected), `away` (it left and may come
back) or `done` (device mode stopped, or the app stopped). It still answers after `stop()`: a log
whose writes outlived onStop's 2 s flush bound carries `stopTimedOut: true`.

### `mark(label: string): Promise<number>`

Writes `{ v: 1, kind: "mark", t, build, rx, label, auto: false, from: "computer" }` into every live
log, `t` on that log's page clock; resolves with how many logs got it (0 when no phone is live). The
label is trimmed and must be 1–200 characters, else:

```
[moku-editor] collector.mark: the label must be 1-200 characters.
  Give a short name, for example "boss".
```

### `adb(): AdbStatus`

`{ state: "off" | "on" | "missing", phones: [{ serial, model, reversed }] }`: off while device mode
is off, missing when adb could not be spawned, else the phones the loop sees.

### The mark route `{path}/perf/mark`

Registered in `onInit` on every server (device mode off included), so `moku-editor perf mark` always
finds it.

| Request | Answer |
|---|---|
| refused by `hub.guard(req, server, "same-origin")` | the guard's 403 |
| not `POST` | 405 `method not allowed` |
| before start / after stop | 503 `not started` |
| no `authorization: Bearer <hub token>` (compared timing-safe, lengths first) | 401 `unauthorized` |
| body (plain text, at most 4 KiB read) empty or over 200 characters after trimming | 400 `{"error":"label"}` |
| otherwise | 200 `{"marked":<n>}` |

Every answer carries `cache-control: no-store`. Without a live log it answers `{"marked":0}` and
creates no folder and no file.

## Events

| Event | Kind | Payload | When |
|---|---|---|---|
| `collector:session` (emits) | per-plugin, visible through `depends: [collectorPlugin]` | `CollectorSessionEvent`: `{ device, file, state, lines, lost, last }` | the first written batch of a log (at once), then at most once a second with a trailing emit carrying the newest counts; at once on `live` again, and after the queue closed the file on `away` and `done` |
| `hub:device` (hooks) | the hub's per-plugin event | `HubDeviceEvent` | `listening` starts the adb loop; `connected` makes the device's away logs live; `lines` writes a batch; `closed` makes its live logs away; `stopped` stops the adb loop and makes every log done |

`collector:session` is not in the global `ServerEvents`. `last` is the `SessionDigest` of the newest
second: fps and loop fps, the gap p90, the GPU p50, the current rate (the newest `rate` event's `to`,
else the header's), the spikes of the second, the primary causes of the last 6 s, the newest heat,
the model, backend, engine and build. The digest reads typed `PerfLogLine` items defensively: a line
missing a field is skipped by the digest and still written.

A `hub:device` after `onStop` is ignored.

## Dependencies

- `filesPlugin`: `files.root()` resolves a relative `out`.
- `hubPlugin`: `addRoutes`, `path()`, `guard`, `token()` for the mark route, and its per-plugin event
  `hub:device`. The hub never calls the collector.

## Lifecycle

- **onInit**: checks the config; registers the mark route (before `serve()` or `listenDevices()`
  freeze the routes).
- **onStart**: not used. Nothing runs (no timer, no process, no file) before `hub:device` `listening`.
- **onStop**: clears the adb timers and the throttle timers, marks every log done, awaits every log
  queue and closes every handle, bounded by `STOP_FLUSH_MS` (2 s). The teardown context has neither
  `emit` nor `ctx.log`: a queue still running after the bound is recorded as the log's
  `stopTimedOut` and reported by `sessions()`. The collector stops before the hub, so the device
  listeners are still up while the files are flushed.

## `report/` — the runtime-free log report

`src/plugins/collector/report/` imports only its own files and `perf/protocol` (types with
`import type`; values: the constants and `primaryCause`, `causeName`, `rateFps`). No `node:`, no
plugin index, no kernel, no ctx: pages' `perf summary` / `perf compare` import it, a browser page
could. `report-boundary.test.ts` holds that line.

| Export | What it does |
|---|---|
| `parsePerfLog(text)` | One pass over a `.jsonl` file. Skipped and counted: `notJson` (a log cut mid-write), `noVersion` (the game's old log), `otherVersion` (a newer schema), `unknownKind`, `badShape` (a known kind failing its minimal check, e.g. a `frameHist` without 81 slots). `overlay`, `pool-trim` and `warm` event lines go to `frameEvents`, `rate` lines to `rates`; `devtools`, `command`, … are read and not kept. Unknown fields stay. |
| `isPerfLog(log)` | At least one header or sample. |
| `bucketUpper(index)`, `histPercentile(hist, share)` | The 81-bucket `frameHist`: upper edges (index 80 is 200 ms and over); nearest-rank percentiles of the merged histogram, `over` for the last bucket. |
| `gfxPercentile(hist, share)` | The game's percentile of adb gfxinfo's millisecond histogram. |
| `summarize(log)` | One row per screen **and rate** (the same screen at 120 and at 60 fps is two rows; a sample counts at the rate in effect at its `t`, a spike at its own frame's `rateMs`): frames, p50/p90/p99, GPU ms weighted by timed frames, spikes by primary cause and per minute, passes, texture and heap memory, **pool trims** (count and MB freed), **warm-ups** (count and draws), **the game's overlay changes** by `label` + `what`. Frame events count on the screen of the sample whose second holds them. Also heat per device, system frames per mark segment, marks and every rate switch. Linear in the lines (200 000 samples in well under 1 s). |
| `compare(a, b)`, `COMPARE_THRESHOLD` | A/B by screen and rate: p90, p99, spikes per minute, GPU ms; ▲ at +10 % or more (worse), ▼ at −10 % or less; a screen at a rate on one side only has null values and no arrow. |
| `table(head, rows, names)`, `summaryText(summary)`, `compareText(comparison, names)` | The text tables `perf summary` and `perf compare` print (`≥200` and `—` cells, the `Rate:` line, the `Screen events:` block, heat, system frames, marks, the footer). |
| `primaryOf(causes)`, `headerRate(header)`, `rankCauses(counts)` | The small rules the collector's live digest shares with the summary. |

The report's types (`FileLine`, `PerfGapLine`, `HistPercentile`, `ParsedLog`, `ScreenSummary`,
`HeatSummary`, `SystemSummary`, `LogSummary`, `Delta`, `CompareRow`, `Comparison`, `SkippedLines`)
are re-exported from `collector/types.ts`.

## Files

```
src/plugins/collector/
  index.ts          wiring: depends, events, hooks, onInit, onStop
  types.ts          config, adb seam, sessions, loop, state, event, api, ctx; report type re-exports
  state.ts          createCollectorState, createLogSession
  init.ts           config checks, the mark route (hub.addRoutes)
  api.ts            createCollectorApi, the computer mark
  handlers.ts       the hub:device handler
  lifecycle.ts      stopCollector (onStop)
  route.ts          the mark route {path}/perf/mark
  session/          name.ts (file names), clock.ts (offset, page t), digest.ts, writer.ts (queue, gap, lost, emit)
  adb/              run.ts (the process seam), parse.ts (pure parsers), loop.ts (reverse and poll rounds)
  report/           runtime-free: index.ts (barrel), types.ts, parse.ts, hist.ts, summary.ts, compare.ts, text.ts
```

## Limits

- **Without adb** (not installed, or not on PATH) the loop logs `collector:adb-missing` once and
  stops until device mode turns on again. A LAN phone still logs everything it measures itself; there
  is no `adb reverse` (a USB phone cannot reach the computer), no adb heat line (the shell's own
  `thermal` lines still arrive) and no gfx line.
- Two live adb logs of the same model (two identical phones) cannot be told apart by model: nothing
  is polled for that model and `collector:adb-ambiguous` is logged once.
- gfxinfo counts 0 frames under WebGPU: gfx lines are a second opinion; the percentiles come from the
  page's own `frameHist`.
- The phone's own log keeps no computer mark (it would come back as a duplicate line).
