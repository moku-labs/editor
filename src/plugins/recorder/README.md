# recorder

> Complex plugin (agent core). The performance **log on the device**: every line of the engine monitor's stream, for
> hours, in a file per run, with an outbox the opt-in bridge ships to the computer.

The recorder subscribes to `monitor.stream` of the monitor perf found (`perf.monitor()`, the one place that finds it),
keeps every line it is handed as a **reference** in a bounded queue (a line is fresh and deeply frozen, never reused),
and serializes the queue to JSON text on **its own timer**, between `monitor.beginAgent()` and `endAgent()`, so the log
never costs a game frame and its own time is left out of the spike rule. The text goes to two places: the log file of
the current run in a store (OPFS when the page has it, memory otherwise), and an **outbox** of lines the computer has
not confirmed, which the bridge pulls with `unsentRun(max)` and confirms with `ack(log, next)`. The recorder imports no
bridge.

It also writes the editor's own events through `monitor.event`: `devtools` (the editor's window, from the global
`overlay:changed`; never `overlay`, which is the game's overlays), `command` (one line per command run, whoever ran it,
from the registry's `registry:command`) and `recorder` (start, stop, export).

Without a monitor (a headless game, an engine before block 2b) it records nothing: `start` throws, earlier logs can
still be listed, shared and removed.

## The log format

One JSON object per line, exactly as the stream handed it (`JSON.stringify(line)`, the engine's `PerfLogLine` v1); the
recorder adds no field. Order inside a log:

1. The context lines, re-written at every start: the newest `header`, the `startup` line once measured, and the newest
   `display` event when it came after the header.
2. The `recorder` event `{ action: "start", label }`.
3. Every line of the stream while recording (samples, spikes, long frames, events, marks, `thermal`). A `header` that
   arrives while recording is written where it arrives.
4. The `recorder` event `{ action: "stop" }`.

File name: `perf-<yyyymmdd>-<hhmm>-<model>.jsonl` in local time, `model` = `header.device.model` lower-cased with every
character outside `[a-z0-9-]` turned into `-`, `device` without one; a taken name gains `-2`, `-3`, … before `.jsonl`.

```text
perf-20261014-1532-sm-a266b.jsonl
```

## Configuration

| Option | Default | Range | Meaning |
|---|---|---|---|
| `autoStart` | `"device"` | `true`, `false`, `"device"` | Start a log when the plugin starts: `"device"` only on a debug build (agent flag on, dev flag off; the registry's build profile `read` or `full`), `true` always, `false` never. A dev page records only when asked (`start()`, `editor.record`, the overlay's Record tab). |
| `keepMb` | `64` | 1 to 512 | Most MB in memory: unconfirmed outbox lines, memory-store logs, pending text. |
| `flushEveryMs` | `1000` | 100 to 10000 | How often the queue is serialized. |
| `persistEveryMs` | `5000` | 1000 to 60000 | How often text is written to the store (also at 64 KB pending, and at stop). |
| `storage` | `"auto"` | `"auto"`, `"memory"` | OPFS when the page has it, or never on disk. |
| `keepFiles` | `10` | whole, 1 to 100 | Finished logs kept; the oldest beyond go when a log starts. |
| `maxLogMb` | `32` | whole, 1 to 512 | The size of one log: at it the recorder rotates to a new log. 32 is the native share's cap, so every log stays shareable; the store holds at most about `keepFiles × maxLogMb`. |

```ts
createApp({ pluginConfigs: { registry: { game }, recorder: { autoStart: true, maxLogMb: 16 } } });
```

A bad value throws a `TypeError` at `createApp`:
`[moku-editor] recorder.keepMb is 0.` / `  Give megabytes from 1 to 512; 64 keeps about 12 hours of samples.`

When `autoStart` finds no header at start (a native shell holds the engine's header back until it is ready), the log
starts on the first flush tick that has the header, so its file is named after the device and its first line is the
header; after 10 ticks without one it starts anyway (named `device`).

## API

`app.recorder` or `ctx.require(recorderPlugin)` gives `RecorderApi` (contracts and examples on the type in `types.ts`).

| Member | Answers |
|---|---|
| `start({ label? })` | The new log (or the running one). Throws an `Error` without a monitor. |
| `stop()` | The finished log; `undefined` while idle. A store failure keeps the log in memory and warns. |
| `mark(label)` | `true` when the mark went into a running log (`monitor.mark`). |
| `command(id, input, label)` | The overlay's automatic mark of a command it ran: the `mark` line and `{ auto: true, command }` in `marks()`; never a `command` event. |
| `status()` | `{ state, lines, bytes, sent, pending, monitor, file, label, sinceMs, storage, dropped }`. |
| `marks()` | The marks of the current log, or of the last one while idle. A copy. |
| `files()` | The logs, oldest first, the current one last. A copy. |
| `share(name)` | `"shared"` / `"cancelled"` (native share sheet) or `"downloaded"`. The current log is written first. A log over 32 MiB is refused before the native share is called (the shell takes no more): an `Error` naming its size; pull it with the collector over adb (`moku-editor perf`) instead. |
| `remove(name)` | Removes a finished log. |
| `unsentRun(max)` | `{ log, from, lines }`: the oldest unconfirmed lines of one log, a peek. |
| `ack(log, next)` | Confirms that log's lines below `next`. |

Argument errors are `TypeError` (`share` / `remove` of an unknown name, `ack` with a `next` that is not a whole number
from 0), state errors `Error` (`start` without a monitor, `remove` of the log being recorded, `share` on a page with
neither a document nor a native share, a log over 32 MiB for the native share); every message has two lines. The
status shows `exporting` while any share runs; the last one to end sets it back (`recording` while a log runs, else
`idle`).

## The pipeline

- **Listener** (`listener.ts`): called synchronously inside the engine's commit. Keeps the newest `header`, `startup`
  and `display`; while a log runs (also while it is exported) pushes the reference into a ring of 4096 slots; a full
  ring drops its oldest reference and counts it. Without a log (also while a finished log is exported) it queues
  nothing, and a new log empties the ring before its context lines. It allocates nothing and never serializes.
- **Flush tick** (`flush.ts`, every `flushEveryMs`): inside the agent span it drains the queue (each line's text goes
  to the log's pending text and to the outbox with its index in the log), applies `keepMb`, and takes the chunk that is
  due; after the span it starts the chunk's write (one write in flight per log, so chunks keep their order), warns a
  drop streak once and emits `recorder:status` when a number changed. A throwing tick is warned
  (`recorder:flush-failed`), never left to the timer.
- **keepMb**: while the outbox, the memory store and the pending text pass `keepMb`, the oldest finished log of the
  memory store goes first (`recorder:dropped-log`), then the oldest outbox lines (`recorder:dropped`, once per streak).
  The current log's own text is never removed while it records.
- **Rotation** (`rotate.ts`, after each tick): a log's `bytes` are its UTF-8 bytes (counted without encoding, on the
  recorder's timer). The tick's drain stops before the line that would carry the log past `maxLogMb` less a headroom
  (`ROTATE_HEADROOM_BYTES`, 64 KiB, at most 1/16 of the cap: room for the stop event and for the lines a manual stop
  finds in the queue) and marks the log full; a line bigger than half of that goes in anyway, so a rotation always
  makes progress. The rotation carries the lines still queued out, finishes the full log (the stop event, every line
  written, the meta rewritten) and starts the next one at once with the same label and the header/startup/display
  context again, followed by the carried lines (`recorder:started`, then `recorder:rotated { from, to }`). So no
  finished log passes `maxLogMb` on disk (the native share's cap at the default 32), and no line falls between two
  logs or goes into both. A finish that fails before it detached the log rotates nothing (`recorder:rotate-failed`).
  The status shows the new log as the current one; the finished part is listed in `files()` and can be shared or
  removed: a remove or a share of a log that is still being finished (a stop, a rotation) waits for its finish, and
  onStop waits for all of them. The outbox keeps the full log's unsent lines: the bridge ships them first, acked per
  log. `marks()` belongs to the current log, so it starts empty after a rotation.
- **Failed writes**: a rejected chunk goes back in front of the pending text (`recorder:persist-failed`); after three
  in a row the log moves to the memory store for the rest of its life (`recorder:storage`). Nothing is copied into the
  heap: the chunks OPFS already has stay there, later ones go to memory, and a read or share joins both parts (a remove
  takes both). OPFS keeps the meta of its last chunk, so the next launch lists that part as a finished log.
- **Stop** (`session.ts` `finishLog`, shared by `stop` and onStop): the stop event, the queue drained in the agent
  span, every pending text written (a write that fails at stop moves the log to memory and is written there, also when
  it was the third failure in a row), the meta rewritten `current: false`. It needs no emit and no log. onStop also
  revokes the download URLs still waiting for their timer.

## The store

- **OPFS** (`store/opfs.ts`): the directory `moku-editor-perf` under `navigator.storage.getDirectory()`; a log is a
  sub-directory named after the file without `.jsonl`, with `meta.json` (the `LogFileInfo` fields without `current` and
  `storage`, plus `chunks`) and the chunk files `000001.jsonl`, `000002.jsonl`, …. Each append writes a new chunk file,
  never a rewrite of a big one, then the meta (best-effort: a failed meta write keeps the chunk, so a retry writes no
  duplicate); `read` joins the chunks in name order into one `application/x-ndjson` Blob; `remove` is recursive. A log
  a dead page left behind lists as finished. A listed log is named after its directory, never its meta.json, and only
  names of the recorder's form (`perf-<yyyymmdd>-<hhmm>-<model>.jsonl`) are read, written or removed. The handles are
  local structural types.
- **Memory** (`store/memory.ts`): a Map of logs to their chunks; `memoryBytes` is the sum of the text lengths.
- `openStore("auto")` answers memory with the reason when the page has no `getDirectory` or opening fails.
- Persistence across app launches in the native WebView is open with `@moku-labs/native`; a native store would be a
  third `LogStore` and change nothing else.

## The outbox

The outbox holds the lines of every log in serialization order, so a log's lines are contiguous. `unsentRun(max)`
answers the oldest unconfirmed lines of the head's log, at most `max` (anything but a whole number from 1 counts as
1), without taking them: after a reconnect the same run is answered again and the hub drops what it already has by
index. `ack(log, next)` removes that log's head lines below `next`, adds them to `sent` (the log's and the
recorder's) and is idempotent and monotonic. Lines dropped under `keepMb` leave a jump in the index, which the hub
reports as a gap. The consumed head is spliced off once it is longer than 4096 lines and more than half the outbox.

```ts
// bridge (unit 07), shipping the outbox while live:
const recorder = ctx.require(recorderPlugin);
const run = recorder.unsentRun(200); // { log, from, lines } of one log, or undefined
// … send perf.lines { log, from, lines }; on the hub's perf.ack { log, next, n }:
recorder.ack(log, next);
```

## Registry entries

| Id | Kind | Input | Value |
|---|---|---|---|
| `editor.record` | command, `cosmetic` | `{ on: "boolean", label: "string?" }` | `{ on, file }`: `on: true` starts, `on: false` stops |
| `editor.mark` | command, `cosmetic` | `{ label: "string" }` | `{ marked }` |
| `editor.recorder` | source, `changes: "frame"`, no probe | `{}` | `status()`; its watch is called wherever `recorder:status` is emitted, each watch isolated (a throw warns `recorder:watcher-failed` once per streak) |

The commands answer `state: registry.envelope()`; a `start` without a monitor rejects -32000 through the registry's
guard.

## Events

- **Emits** its per-plugin `recorder:status` (`RecorderStatusEvent`: `state`, `lines`, `bytes`, `sent`, `pending`) on
  start, stop, share (exporting and back), remove, and after a flush tick that changed a number. It is not in
  `AgentEvents`: only plugins that list `recorderPlugin` in `depends` hook it (the overlay, the bridge).
- **Hooks** the global `overlay:changed` → `monitor.event("devtools", { mode, tab })`, and the registry's per-plugin
  `registry:command` → `monitor.event("command", { id, input, via, ok })`. Both write whether or not a log records.

A command run from the overlay is logged once: the registry emits `registry:command { via: "overlay" }` → this hook
writes the `command` line; then the overlay calls `recorder.command(id, input, label)`, which adds only the mark.

## Log events

`recorder:started`, `recorder:stopped`, `recorder:rotated`, `recorder:shared`, `recorder:storage`,
`recorder:dropped-log` and `recorder:no-monitor` at info; `recorder:persist-failed`, `recorder:dropped`, `recorder:remove-failed`,
`recorder:list-failed`, `recorder:flush-failed`, `recorder:watcher-failed` and `recorder:rotate-failed` at warn.
onStop logs nothing.

## Dependencies

| Kind | Name | Used for |
|---|---|---|
| `depends` | `registryPlugin` | `add` of `editor.record`, `editor.mark` and `editor.recorder` in `onInit`, `envelope()` for the commands' `state`; its per-plugin `registry:command` (hooked) |
| `depends` | `perfPlugin` | `monitor()` in `onInit`: the one place that finds the engine monitor |
| global event | `overlay:changed` | hooked: the `devtools` monitor event |
| per-plugin event | `recorder:status` | emitted, declared with `register<RecorderStatusEvent>()`; the overlay and the bridge hook it through `depends` |
| protocol | `../perf/protocol` | type only: `PerfLogLine` of the queued lines |
| protocol | `../registry/protocol` | `checkInput`, `toWireValue` and the `Json` type of the entries |

The recorder never imports the bridge or the overlay: the bridge pulls with `unsentRun` / `ack`, and the overlay
calls the API.

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Checks the config (a two-line `TypeError` at `createApp`), takes `perf.monitor()`, adds the three registry entries, and logs `recorder:no-monitor` at info without a monitor. |
| `onStart` | Opens the store (`openStore(storage)`: OPFS, or memory with the reason logged as `recorder:storage`); with OPFS lists the logs an earlier launch left (a failed list warns `recorder:list-failed`). Without a monitor it stops here. Otherwise subscribes to `monitor.stream` and starts the flush timer every `flushEveryMs` (a throwing tick warns `recorder:flush-failed`). When `autoStart` says so for this build (`"device"`: a debug build only), a log starts now when the engine's header is there, else on the first tick that has it, at most 10 ticks later. |
| `onStop` | Clears the timer and the autoStart wait, revokes the download URLs still waiting, finishes the running log (`finishLog`: the stop event, the queue drained in the agent span, every pending text written, the meta rewritten), unsubscribes the stream and drops the watches. No emit and no log line: the teardown context has neither. |

## Files

| File | Role |
|---|---|
| `index.ts` | Wiring: depends, config, the `recorder:status` event, state, api, hooks, lifecycle. |
| `types.ts` | Config, log and outbox shapes, the per-plugin event, state, ctx, hooks, the API (contracts and examples on its members). |
| `state.ts` | `createRecorderState` (the queue allocated once, the memory store) and the shared reads: a log's info, the file list, the status and its event. |
| `api.ts` | `createRecorderApi`: thin calls into the domain files. |
| `lifecycle.ts` | The config check, `initRecorder`, `startRecorder`, `stopRecorder`. |
| `listener.ts` | The `monitor.stream` listener: references in a ring of 4096 slots; allocates nothing, never serializes. |
| `flush.ts` | The flush tick inside the agent span, the `keepMb` bound, the chunk writes and their failures. |
| `rotate.ts` | Rotation at `maxLogMb`: finish the full log, start the next with the same label. |
| `session.ts` | The life of a log: file name, start (context lines first), `finishLog`, `remove`, the `keepFiles` bound. |
| `marks.ts` | A user mark and the overlay's automatic mark of a game command (`monitor.mark`). |
| `outbox.ts` | The unconfirmed lines: `unsentRun`, `ack`, the head splice. |
| `share.ts` | The native share sheet (32 MiB limit), else a download link, else an error. |
| `entries.ts` | `editor.record`, `editor.mark` and the source `editor.recorder`. |
| `handlers.ts` | The hooks: `registry:command` → `command`, `overlay:changed` → `devtools`. |
| `store/` | `index.ts` (`openStore`), `opfs.ts` (chunk files and `meta.json` under `moku-editor-perf/`), `memory.ts`, `types.ts` (the `LogStore` shape and the structural OPFS handles). |

## Why recorder and perf are two plugins

perf is the **read model** of the last 6 s: typed arrays allocated once, a 4 Hz allocation-free read, answers for the
overlay and the sources, nothing kept beyond the window. The recorder is the **persistence and outbox pipeline**: every
line for hours, serialization on its own timer, OPFS chunks, share, and the unconfirmed lines the bridge ships. They
change for different reasons (a graph rule vs a storage or wire rule), fail differently (a missed paint vs a lost log)
and are tested apart. The bridge depends on the recorder alone and never touches perf; the recorder reaches the monitor
through `perf.monitor()` only.
