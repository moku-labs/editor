# renderView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Render workspace, "Mission control" (spec 09
> § Delta 2026-10-16), and the scene cards (render tree, textures, bundles, pools, release log).

Mission control has exactly **one source** at a time — the local preview or one device — named in a connection bar,
and every number on the page comes from it. renderView never chooses the source: it reads `activeSource.current()`
and `label()` and takes `activeSource:changed`. Under the bar: a live frame timeline over a 2-minute history with a GC
lane and rate-change, recording, compile and source-switch marks, a Shaders & passes lane on the same axis, an
overview scrubber with pause, rewind and step, a range selection with an inspector, sparkline cards on the shared time
axis (FPS with the rate switch, frame time, draw calls, textures, GPU passes, memory, device load), a static facts row,
a Shaders & passes panel, and one collapsible "Scene details" section (collapsed by default) holding the scene cards.
Hovering a tree row or a texture row draws a pink box (`--pick-tree`) around the element over the game frame.

Build state: the data (`series/`, `view/`), the painters (`timeline/` except `loop.ts`), the words (`derive/`) and the
wiring (`source/`, `actions/`, the api, the hooks and the lifecycle) are built (wave 3, RV1–RV4). The components of
`components/connection|instrument|cards|passes|inspector|scene` and `timeline/loop.ts` land in wave 4 (RV5, RV6); until
then they are typed stubs and the workspace renders the scene cards.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `releaseLogMax` | `number` | `50` | Release log entries kept, newest first. |

`fpsSamples` is removed (the FPS card reads the history). Mission control adds no option: the history's size is perf's
`HISTORY_MS` (120 000) and `HISTORY_ROWS` (14 400), a rule of the data. The asset manifest has no config: it is the one
the project index names (`ProjectState.manifest`).

## API

`app.renderView` is `RenderViewApi` (`types.ts`). Every Mission control member re-renders Mission control after it acts.

| Member | Signature | What |
|---|---|---|
| `refresh` | `() => Promise<void>` | Re-reads the asset manifest and the calibration (`game.locate` or `game.rect`). Not a poll. Never rejects. |
| `snapshot` | `() => RenderSnapshot` | The scene cards: `{ frame, tiles, tree, textures, bundles, pools, releases }` (tiles: draw calls, textures, scene). Copies. |
| `reveal` | `(ref: ElementRef) => void` | Shows Render, opens the ancestors, selects the row. Waits for the first scene when Render was hidden. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | Pink box around the element over the game frame; `undefined` clears it. |
| `sortTextures` | `(key: TextureSortKey) => void` | The same key flips the direction. |
| `filterBundle` | `(bundle: string) => void` | `"all"` or a bundle name. |
| `mission` | `() => MissionView \| undefined` | What the page shows, in copies: source and state (live, waiting, not started, no monitor), live or paused and how far behind, span, selection, the frames header numbers (GCs only while memory is measured and on), rate, Monitoring rows, overdraw, memory (source rule, heap, process memory, Leak?), recording. `undefined` without a source. |
| `inspect` | `() => InspectorView \| undefined` | The inspector's summary of the view, or its range view of the selection. Copies. |
| `pause` | `() => void` | Freezes the view at the live end; the history keeps filling. Nothing without frames. |
| `live` | `() => void` | Back to live; clears the selection and its detail read. |
| `setSpan` | `(span: 6000 \| 30000 \| 120000) => void` | Keeps the view end; a paused view whose start left the history is pushed forward. |
| `seek` | `(endMs: number) => void` | Pauses and moves the view end (source clock), clamped into `[min(oldest + span, live), live]`. |
| `select` | `(range: FrameRange \| undefined) => FrameRange \| undefined` | Pauses, clamps to the history, scrolls into view (re-centred at 45 % in the outer 8 %), starts the detail read and looks up its systems' files; `undefined` clears. |
| `step` | `(dir: 1 \| -1) => number \| undefined` | One frame from the selection's edge (no selection: the view's centre frame); stops at the ends. |
| `jump` | `(kind: "spike" \| "gc" \| "rate", dir: 1 \| -1) => FrameRange \| undefined` | The next spike group (whole), GC or rate change; none toasts "No spike after this point" / "No spike earlier in the 2 min history". |
| `setRate` | `(choice: 60 \| 120 \| "adaptive") => Promise<RateAnswer>` | `game.frameRate { fps }` or `{}`. One in flight ("Busy…" at once). A held pin (`heldBy: "panel"`, or `asked` above `fps`) is `ok: false` and keeps the previous radio. Never rejects. |
| `setSection` | `(section: MonitorSection, on: boolean) => Promise<SectionsAnswer>` | `editor.perf.sections` with exactly the row's keys (`nodes` → `{ nodes }`, `passes` → `{ passes, shaders }`); Frames and Render stats are always on. Flips after the answer. Never rejects. |
| `setOverdraw` | `(on: boolean) => Promise<boolean>` | `game.debug { overdraw }`; the old flag (and a toast) on a refusal. |
| `record` | `(on: boolean, label?: string) => Promise<RecordAnswer>` | `editor.record { on, label }`; the page sends no origin (the hub stamps it). Stop toasts the saved path. |
| `mark` | `(label?: string) => Promise<boolean>` | `editor.record { mark }`; an empty label becomes "mark {n + 1}". |

Removed with the D1 strip: `device`, `stepSpike`, `openSpike`, `closeSpike`, `setMore` (use `mission`, `jump`, `step`,
`select`, `inspect`).

```ts
app.workspace.show("render");
app.renderView.mission()?.source; // { session: "s-9", kind: "device", name: "Galaxy A26", link: "wire", state: "live" }
app.renderView.select({ from: 4810, to: 4860 }); // { from: 4810, to: 4860 }: one editor.perf.detail read 150 ms later
app.renderView.inspect()?.kind; // "range"
await app.renderView.setRate(120); // { ok: true, choice: 120, text: "Pinned at 120, adaptive off", fps: 120, mode: "forced" }
```

## Data path — the one-source rule (spec 09 § M2)

| Read | Kind | Into |
|---|---|---|
| `editor.perf.second` | watched, 1 Hz | `mission.second` (rate, facts, Monitoring, memory trust, caps, epoch); its `sample` into the history (`appendSample`: the per-second systems a range falls back on) and the 1 Hz series (textures MB, object counters, render targets; the local preview's heap when trusted) |
| `editor.perf.frames { after }` | the poll, 1 s | `appendFrames` into the 2-minute history; the overview's 500 ms buckets; each answer with new rows feeds the playout clock |
| `editor.perf.events { after }` | the poll, after the frames answer | `appendEvents` (raw lines → marks: rate, gc, shader, problem, mark…) and the overview's GC and rate flags |
| `editor.perf.passes` | watched, 1 Hz | `mission.passes` (the raw second for the panel, `passesSummaryOf`) and `appendSecond` |
| `editor.recorder` | watched, 1 Hz | `mission.recorder` (the pill, the popover, the timeline's stripe) |
| `editor.perf.detail { from, to }` | once per settled selection (150 ms) | `appendFrames` and the range's nodes |
| `activeSource.onTelemetry` | 1 Hz, wired Android only | `mission.telemetry`; heap samples, inferred GCs and load placed at `at + clockOffsetMs − timeOrigin` (without an offset kept for the cards, not placed) |

- Each read, watch or poll is sent only when the active session's manifest lists the id available (`source/listed.ts`):
  an agent before the Mission control feeds sends nothing new and the page says its editor agent is older; never a crash.
- The poll never doubles a read in flight, retries a failed read on the next tick (one debug line per failing streak),
  and drops an answer that arrives after it stopped. A new `epoch` (a reload) resets the history, the series and the
  selection.
- **Source switch** (`activeSource:changed`): one burst — every watch and the poll of the old source stop; the history
  (kept allocation), the series, the clock, live view, the selection, the detail read, the answers in flight, the file
  cache and every popover reset or close (the Connect panel stays for its success alert on a switch to a device the
  person asked for: "Connected to {name}.", one toast, closed after 1.3 s); the new source's reads start. A device
  source gets no scene watch and no calibration (R4).
- **Render hidden**: every Mission control watch and the poll stop, the history is kept (a return polls on from the
  newest frame), the instrument's loop stops, popovers close (the scan lease ends).
- Every value is checked (`source/guards.ts`): a value of another shape is warned (`renderView: unexpected source
  shape`) and dropped, never shown.

The scene cards keep their own reads: `game.render`, `game.assets` (and `game.effects` by manifest) for the session,
`game.ui`, `game.entities`, `game.projections` only while Render is shown and never on a device session.

### Motion, history, selection (spec 09 § M11)

- `view/clock.ts`: the playout-delay display clock of every live graph, fed by the frames answers; reduced motion steps
  every 500 ms at the newest data.
- `view/view.ts`: live, pause (`behindMs` grows while the history fills), seek, span, the paused view kept inside the
  history. `view/selection.ts`: click (one frame) or drag (≥ 4 px) ranges, any selection pauses, step, jump, a
  selection whose first frame left the history is cleared. `view/keys.ts`: → steps, Shift+→ jumps a spike, Space
  toggles live, Esc closes a popover first and only then clears the selection.
- `series/`: the side series allocated once (`createMissionSeries`) — overview buckets, heap and GCs, textures, object
  counters, device load — trimmed to the same 2 minutes, emptied by `clearSeries`; `series/stats.ts` the frames header
  numbers (spike groups, worst, awake p90, rest clipped to the view, GCs); `series/groups.ts` spike groups.

### Painters (spec 09 § M8, M9)

`timeline/` paints on a `PaintContext` (a `CanvasRenderingContext2D` or a test fake) with a `PaintScene` reused frame
after frame: the frame timeline (`frames.ts`, `marks.ts`), the Shaders & passes lane (`lane.ts`), the overview
(`overview.ts`), the cards' sparklines and the Device load steps (`spark.ts`) and the health line (`health.ts`). Rows
newer than the view's end are not drawn yet (the playout delay); rows older than the view are skipped by a binary
search. Painters allocate nothing per frame: strings come from bounded caches (`labels.ts`), flag boxes go into
preallocated typed arrays (`hit.ts`), dash patterns are module arrays. Colours are the workspace tokens resolved once
per theme (`palette.ts`, `MISSION_CAUSE`: JS warn, GPU pick-pink, upload phase-2, compile pick-blue, long frame error).

## Events

renderView declares no events.

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:inspect` | `{ ref }` | The render tree card's "Inspect in Game". |
| Emits | `workspace:open-file` | `{ path, line }` | A file link in the inspector (with the toast "Open in editor: {path}:{line}"). |
| Hooks | `workspace:changed` | `{ ws }` | `render`: scene watches (not on a device), Mission control's watches and poll, refresh once per session. Other: all of them off (history kept), loop stopped, popovers closed, box cleared. |
| Hooks | `link:status` | `{ status, session? }` | Silent or lost: data kept, Mission control re-renders stale. A new session while live or paused: session data cleared. `empty`: everything cleared. |
| Hooks | `link:project` | `{ state, delta }` | Reads a stale catalogue again. |
| Hooks | `workspace:reveal` | `{ ref }` | `reveal(ref)`. |
| Hooks | `activeSource:changed` | `SourceChange` | The switch burst. |
| Hooks | `activeSource:connect-requested` | `{ tab }` | Shows Render with the Connect panel open on that tab. |

Log events: `renderView: unexpected source shape` (warn), `renderView: calibration failed` (warn),
`renderView:poll-failed` (debug, once per failing streak).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch`, `read`, `run` on the active session (link routes them to the source activeSource chose), `manifest()`, `onManifest`, `engine()`, `files.find("system:<name>")`, `files.read` of the asset manifest, `project()`, `sessions()` / `session()` |
| `workspacePlugin` | `show("render")`, `active()`, `theme()`, `onPrefs`, `toast`, `startLocalPreview()`, `gameFrame().overlay()`, `palette.add` |
| `panelsPlugin` | `register` the Render panel |
| `activeSourcePlugin` | `current()`, `label()`, `preview()`, `health()`, `directory()`, `scan()`, `connectDevice`, `connectNetwork`, `confirmPairing`, `refusePairing`, `useDevice`, `useLocal`, `stopDevices`, `telemetry()`, `onTelemetry`, `markers()`, `clockOffsetMs()`, and its two events |

`source/contract.ts` is the one door to the other units' runtime-free modules: `perf/protocol` (the history and its
functions, the feeds' wire types, the monitoring constants, the cause ranking) and, type-only, `recorder/protocol`,
`activeSource/types` and `connect/protocol`. The tools page no longer imports `perf/graph` (the overlay keeps it).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Render panel. |
| `onStart` | Takes the active source; starts the session watches (the one manifest listener also restarts Mission control's reads with what a new manifest lists); recalibrates on a device change and re-renders Mission control on a theme change (`workspace.onPrefs`); takes the active device's telemetry (`activeSource.onTelemetry`); runs the `workspace:changed` logic at once when Render is already shown. |
| `onStop` | Every watch and listener, Mission control's watches, poll, loop, detail read and popovers (the scan lease ends), the overlay root and the palette items. |

## Files

| Path | Role |
|---|---|
| `index.ts`, `types.ts`, `state.ts`, `api.ts`, `handlers.ts`, `lifecycle.ts` | Wiring, types, state and the two UI stores (`notify` for the scene cards, `notifyMission` for Mission control), the api, the hooks, the lifecycle. |
| `watch.ts`, `derive.ts`, `format.ts`, `actions.ts`, `guards.ts`, `overlay.ts`, `panel.tsx` | The scene cards. |
| `source/` | `contract.ts` (the one door), `types.ts`, `guards.ts`, `listed.ts`, `sync.ts` (watch set, switch burst), `poll.ts`. |
| `series/` | `types.ts`, `series.ts` (allocation, `pushSample`, `clearSeries`), `rows.ts` (binary searches), `overview.ts`, `samples.ts`, `telemetry.ts`, `stats.ts`, `groups.ts`. |
| `view/` | `types.ts`, `clock.ts`, `view.ts`, `selection.ts`, `keys.ts`. |
| `timeline/` | `layout.ts`, `palette.ts`, `scene.ts`, `labels.ts`, `draw.ts`, `frames.ts`, `marks.ts`, `lane.ts`, `overview.ts`, `spark.ts`, `health.ts`, `hit.ts`, `loop.ts` (wave 4). |
| `derive/` | Pure words and views: `words.ts`, `connection.ts`, `rate.ts`, `monitoring.ts`, `record.ts`, `connect.ts`, `cards.ts`, `memory.ts`, `load.ts`, `passes.ts`, `inspector.ts`, `states.ts`, `mission.ts`. |
| `actions/` | `rate.ts`, `sections.ts`, `record.ts`, `detail.ts`, `files.ts`, `connect.ts` (incl. the local preview's start), `popover.ts`. |
| `components/` | The scene cards; Mission control's components (wave 4). |
| `styles/` | `render.css` and its `@scope` sheets. |

## Scene details and narrow layout (wave 4)

The scene cards move into one collapsible "Scene details" section, collapsed by default (`mission.sceneOpen`, not
persisted); collapsed, nothing inside renders. renderView's root is the inline-size container `render`: below 1180 px
the inspector moves under the instrument, the cards and the passes panel go to 2 columns and the connection bar stacks;
below 680 px the timeline is 220 high and the Connect and passes panels are one column. No horizontal scroll.

## Limits

| Limit | Shown as |
|---|---|
| iOS / WebKit: no GPU timer, no JS heap. | "not measured on this device", never 0. |
| Tile GPUs (Mali, Adreno, Apple, PowerVR): a pass's GPU time is a share of the frame. | "≈ {share} %", never ms per pass; the frame's GPU sum keeps ms. |
| An Android WebView's `performance.memory` is frozen (the A26 finding). | Never shown as the device's heap: a wired phone's heap comes from CDP over USB; a phone on the network reads "Not available: connect by wire to read the heap". |
| GPU clock scaling (DVFS). | A wired phone's GPU ms carries its clock ("at 585 MHz, 64 % busy"). |
| Filters by kind only (v1). | No filter parameters. |
| Connect v1: no LAN scan, no editor-issued code, no QR, no iOS debug build. | "Listen on the network" and the address the phone dials; the iPhone line. |
| `editor.perf.detail` rows older than the newest held frame are not merged (perf's `appendFrames` dedups by frame). | The range keeps the history's rows; the detail's nodes still show. |
| No render phase split, no per-pool counts (F-R1); texture rows from the committed asset manifest (F-R2); the release log is a diff (F-R3); tree types are ui tags and entity kinds (F-G1). | As before. |
