# renderView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Render workspace (design A3, C9) and the D1 device strip (spec 09).

Title "Render · game.render · frame N"; under it, for a session whose agent lists `editor.perf.*` (a phone, or the
game page in the editor's frame), the D1 device strip; then five metric tiles (six with the JS heap tile in Chromium),
the render tree card and the textures card on the left, the Bundles, Pools and Release log cards on the right.
Hovering a tree row or a texture row draws a pink box (`--pick-tree`) around the element over the game frame.
The box lives in renderView's own root inside `workspace.gameFrame().overlay()`, so it shows in the pinned preview.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `fpsSamples` | `number` | `60` | FPS samples kept for the sparkline, one per changed `game.render` value. |
| `releaseLogMax` | `number` | `50` | Release log entries kept, newest first. |

The asset manifest has no config: it is the one the project index names (`ProjectState.manifest`). The config `manifestPaths` is removed.

## API

`app.renderView` is `RenderViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `refresh` | `() => Promise<void>` | Re-reads the asset manifest and the calibration (`game.locate` or `game.rect`). Not a poll. Does nothing while the link is not live or paused. Never rejects. |
| `snapshot` | `() => RenderSnapshot` | `{ frame, tiles, tree, textures, bundles, pools, releases }`. Texture rows have the filter and sort applied. Copies. |
| `reveal` | `(ref: ElementRef) => void` | Shows Render, opens the ancestors, selects the row and scrolls it into view. Waits for the first scene when Render was hidden. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | Pink box around the element over the game frame. `undefined` clears it. A ref without a rect draws nothing. |
| `sortTextures` | `(key: TextureSortKey) => void` | The same key flips the direction. A new key sorts numbers descending, text ascending. |
| `filterBundle` | `(bundle: string) => void` | `"all"` or a bundle name. |
| `device` | `() => DeviceStripView \| undefined` | The D1 strip as it shows now: session, link (`adb`/`lan` with address and port, or `browser`), seen seconds, perf state, model, about line, backend, rate, engine (device, computer, `stale`), build and profile, REC, the spikes with their primary cause, the selection, the `n/total` counter, the record panel's kind and frame, More. Copies. `undefined` while the session's manifest lists no `editor.perf.second`. |
| `stepSpike` | `(dir: 1 \| -1) => number \| undefined` | The chevron keys: the next or previous spike of the strip's window, wrapping, and opens its record. From no selection next takes the oldest, previous the newest. `undefined` without a spike or a strip. |
| `openSpike` | `(frame: number) => Promise<void>` | Selects the frame and reads `editor.perf.spike { frame }` once (an open of the same frame while it loads shares the read). `null` shows "Frame N is no longer on the phone", a failure its bare message. A late answer for a record closed or replaced since is dropped. Never rejects. |
| `closeSpike` | `() => void` | Closes the record panel; the selection stays; the panel shows "No spike selected". |
| `setMore` | `(open: boolean) => void` | Opens or closes More under the graph (open by default; not persisted). |

`TextureSortKey` is `"key" | "bundle" | "size" | "gpuMb" | "fileMb" | "use"`.

```ts
const { tiles } = app.renderView.snapshot();
tiles.drawCalls; // { kind: "absent" } in a production build
tiles.scene?.effects; // { particles: 18, emitters: 1, filters: 24, renderPasses: 49 } on game 0.0.3
tiles.effectsInstalled; // false on a game without the effects plugin, else absent
tiles.heap; // { kind: "value", usedMb: 12.8, limitMb: 4095.8 } in Chromium, { kind: "absent" } elsewhere

app.renderView.reveal({ kind: "entity", id: 3_145_728 });
app.renderView.snapshot().tree.find(row => row.id === "entity:3145728")?.depth; // 2

app.renderView.highlight({ kind: "ui", path: "boardScreen/boardSlot" });
app.renderView.highlight(undefined);

app.renderView.filterBundle("ui");
app.renderView.snapshot().textures.every(row => row.bundle === "ui"); // true
```

### Derivations

| Output | Rule |
|---|---|
| Draw calls tile | The `game.render` counter, a dev-build counter on any backend. Without it: "Not counted in a production build". Sub-line "R render pass(es)" when `game.render` reports `renderPasses` (game 0.0.3), else "game.render" or "game.render reports no draw counter". |
| FPS tile | The newest sample, a sparkline of the kept samples. Sub-line "last N samples · low L". When the newest sample is 28-32 fps: "Resting at 30 fps: nothing moved for 2 s (game time.idleFps)". Game time rests at 30 fps after 2 s without a change (D-28). |
| Frame time tile | `frameMs`. One bar, no phase split. |
| Scene tile | Entities, "V display objects · P pooled", and "P particles · E emitters · F filters" from `game.effects`. On an older game: "Particles and filters are not reported (follow-up F-R1)". On a game without the effects plugin (`game.effects` listed with `available: false`): "Effects not installed in this game", also while the tile waits for the scene. |
| JS heap tile | `link.heap()` read on each `game.render` change: "JS heap · <used> MB · of <limit> MB". The page reports it from `performance.memory` (Chromium). Absent: the tile is not rendered. Cleared on a session change. |
| Texture rows | Catalogue textures whose bundle is in `game.assets`. GPU MB = w × h × 4 / 2^20. |
| Texture use | Per scene: referenced keys are in use. A key seen before and not referenced now is "unused since fF". A key never seen is "not seen since f<firstFrame>". Precision is one delivered value, only while Render is shown. |
| Pools | One row "All pools". No per-pool counts. |
| Release log | A bundle in the previous `game.assets` value and not in this one, at the frame of the last `game.render`. Shown as "≈fN". |
| Tree rows | Depth first over the scene roots, only through open nodes. The roots open on the first scene of a session. |

## Events

renderView declares no events. It uses the global tools events (R4, R9).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:inspect` | `{ ref }` | The C9 "Inspect in Game" button. gameView hooks it. |
| Hooks | `workspace:changed` | `{ ws }` | `render`: scene watches on (none on a device session, R4), the strip's device watches on when the manifest lists `editor.perf.second`, refresh once per session. Other: scene and device watches off (one burst; the strip keeps its data), box cleared, the repaint loop stops with the canvas. |
| Hooks | `link:status` | `{ status, session? }` | Silent or lost: data kept; the strip reads stale (`data-stale`) and its link cell "silent N s". A new session while live or paused: session data and effects cleared, the strip re-evaluated (a new session id starts it empty). `empty`: everything cleared, the strip too. |
| Hooks | `link:project` | `{ state, delta }` | Reads the catalogue again when it is stale: a gap (`delta.all`: the first state, a reconnect, the index turned off), another manifest named or none any more, or `delta.files` holds the manifest. A catalogue not read yet stays unread until Render is shown. The Textures palette follows. |
| Hooks | `workspace:reveal` | `{ ref }` | gameView's "Show in render tree": `reveal(ref)`. |

Log events: `renderView: unexpected source shape` (warn, once per wrong value), `renderView: calibration failed` (warn).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of the game sources and the device sources, `read("game.locate")` or `read("game.rect")`, `read("editor.perf.spike")`, `manifest()`, `project()` (the asset manifest path), `files.read` of the manifest, `onManifest`, `status()`, `heap()`, `sessions()` and `session()` (the session's `device`), `engine()` and `onEngine` (STALE) |
| `workspacePlugin` | `show("render")`, `active()`, `onPrefs` (device change), `gameFrame().overlay()`, `palette.add` |
| `panelsPlugin` | `register` the Render panel |

Shared modules: `panels/shared/scene` builds the scene from `game.ui`, `game.entities` and `game.projections` (R8). `panels/shared/project` gives `manifestOf` and `projectOffText`.
renderView depends on no other view (R4). The strip reads the perf and recorder contracts only through
`device/contract/` (see [Device sessions](#device-sessions-spec-09)) and `import type` of `hub/protocol`
(`SessionDevice`); it never imports `collector/report` or a plugin instance of another core.

### Data path (R6)

| Watch | When | Why |
|---|---|---|
| `game.render`, `game.assets` | The whole session (onStart). | FPS samples and the release log need every change since the editor connected. Each `game.render` change also stores `link.heap()`. |
| `game.effects` | The whole session, only while the manifest lists it as available (game 0.0.3). | Particles, emitters and filters for the Scene tile. |
| `game.ui`, `game.entities`, `game.projections` | Only while Render is shown. | Entities can be large. |

- The bridge re-reads each watched frame source once per heartbeat and sends changes only. No timer reads a frame source.
- A burst of scene values builds one scene per animation frame.
- The page rect of the first keyed ui element calibrates the scene once per session and again after a device change.
- That rect is read with `{ key }` from `game.locate` when the manifest lists it (game 0.4), else from `game.rect` (game 0.1). A manifest that lists neither reports no element rects: nothing is read, nothing is warned, and the scene stays uncalibrated.
- The asset manifest is the file the project index names (`manifestOf(link.project())`), read through `link.files.read`. Nothing is read while the index is off or names none. The textures card then says why: "Project index is off: <reason>", "The project index found no asset manifest", or "No asset manifest of version 1 at <path>". A project change that makes the catalogue stale reads it again (`link:project`), shown or hidden, so Render opened before the first project state still gets its rows.
- `game.effects` follows `link.onManifest`. A manifest that lists it starts one watch. A manifest without it stops the watch and clears the value. A lost session keeps it.
- A game without the effects plugin lists the source with `available: false` (the agent's probe). renderView sends no watch, sets `effectsInstalled: false` on the tiles and the Scene tile reads "Effects not installed in this game". Nothing is logged. `empty` forgets the flag.
- A value of the wrong shape warns once and the last good value stays.

### Device sessions (spec 09)

A session gets the D1 strip when its manifest lists `editor.perf.second`: a **device session** (a phone linked to
the hub's device listener; its `SessionInfo.device` carries model, link, address, port, engine and build) or a
**browser session** (the game page in the editor's frame whose agent composes perf; no `device`). The kind of session
decides only the device-only cells: a browser session's link cell is the outlined `BROWSER` legend with "seen N s
ago", and its header bar reads "Browser".

| Watch | When | Why |
|---|---|---|
| `editor.perf.second`, `editor.perf.window`, `editor.perf.spikes`, `editor.recorder` | While Render is shown and the session's manifest lists `editor.perf.second`; each only when listed available. | The device row, the headline, More, the frame graph (the strip's own window, filled by `readWireWindow`), the spike counts, REC. |
| `editor.perf.spike { frame }` | A read on demand (a flag, a bar, the chevrons). | The record side panel. |
| `game.ui`, `game.entities`, `game.projections` and the calibration | **Not on a device session** (R4): serializing a scene tree costs the phone the frames the strip measures. A browser session keeps them. | The tree card reads "The render tree is not read from a device: reading it costs the phone frames." |

- Hidden Render or another session drops every device watch at once; the strip keeps its data for a return to the same session and starts empty on a new session id.
- The graph is drawn with an interpolated time axis (spec 09 Amendment 2026-10-15): on each `requestAnimationFrame` the painter gets `now = window.endMs + (performance.now() − receivedAt)`, capped at one read (`REPAINT_MS`, 250 ms) past the newest row, so the graph scrolls between the 4 Hz window reads and a new row appears at the right edge when time reaches it. The loop runs only while Render is shown, the tab is visible and the session is live: a window value restarts it (a 250 ms supervisor), and 2 s without one (`STALE_AFTER_MS`) stops it at the last frame. `prefers-reduced-motion` keeps the 4 Hz steps without a moving `now`. "seen N s ago" and the REC clock re-render once a second (`RECORD_TICK_MS`). The supervisor, the clock, the frame and the theme listener live with the mounted canvas and stop with it; onStop clears what is left.
- Each frame blits a static base layer and paints the moving part over it. The base (the well, the grid, the tape's body) is drawn into an offscreen canvas only when the CSS size, the dpr (clamped to 1…3) or the theme changed; the moving part (bars, budget, flags, tape marks, readout, axis, `now`) draws only the rows inside the visible span. The legends' text measures stay cached and are taken again once Geist has loaded or the theme changed. A click hits the flags and bars of the frame on screen: its time origin is the one of the last paint.
- A frame reads no layout and asks no media query (review W4): the canvas's CSS box is read once at mount and then follows a `ResizeObserver` (its border box; a new box repaints a stopped strip), `prefers-reduced-motion` is one `MediaQueryList` whose `change` event switches between the loop and the 4 Hz steps, and the loop paints with one view object per kind (moving, still, base) changed in place. The cleanup disconnects the observer and drops the listener.
- The strip follows the editor's look and theme (spec 09 Delta 2026-10-15): an editor card like the Render cards (`--surface-panel`, `--line-1`, `--radius-10`), Geist for words and Geist Mono for numbers, every colour an editor token. Light and dark follow the editor's theme switch with no reload: the sheets read `light-dark()` tokens, the colours the graph also draws (a cause key, a stack swatch, the budget bug, the GPU bars of a record) go inline as `--c`, a `light-dark()` of the graph's light and dark palette (`device/colour.ts`), and the canvas repaints with `graphLook("light" | "dark")` from `workspace.theme()` on every theme change. The light theme's cause hues are darker ones that hold 3:1 on the light well (`causeHue`). The phone overlay keeps its glass cockpit (spec 08).
- The headline reads "idle since HH:MM:SS" (the phone's wall clock) instead of drawn / loop while the engine idles (`PerfSecond.activity.idle`); its p90 is `activity.p90Ms` over awake frames (the sample's gap p90 on an agent without `activity`); the GPU part is "GPU p50 0.5 / p90 1.2 ms" from the window's `gpuP50Ms` / `gpuP90Ms`, "GPU 6.0 ms avg" from `meanGpu` on an older window, "GPU — no timer" without a timer; the display Hz comes from `rate.displayHz`.
- The legend's budget bug reads the same value as the headline's `@60`: "budget 16.7 ms at 60 fps" from `PerfSecond.budgetMs` and `rate.fps`, the window's newest row before the first second (design check D1).
- The strip has its own subscription (`device/state.ts` `notifyStrip`, `useDeviceStrip`): a device value, the selection, the record, More and the 1 s clock re-render the strip only, never the workspace snapshot (`deriveSnapshot`). A session gaining or losing its strip re-renders the workspace.
- A click on the graph after a new window arrived and before the next repaint paints first, so the flags and bars it hits are the ones on screen.
- Every value is checked down to each member the strip reads (`device/guards.ts`): a cause must be one of `CAUSE_STYLE`, a window must span 0 < span ≤ 60 s. A value of another shape is warned, dropped, and the last good one stays: the Render workspace never throws on it.
- STALE: the phone's engine fingerprint (`PerfSecond.engine`, else the session's `device.engine`) against the computer's (`link.engine()`), only when both are known and differ.
- `device/contract/index.ts` is the one door to perf's `perf/protocol` (the window, its wire form with the 60 s span rule and the unknown cause bits dropped, the values, `createPerfWindow`, `readWireWindow`, `rowOfFrame`, `stepSpike`, `spikeOrdinal`, `meanGpu`), `perf/graph` (`paintGraph`, `createGraphState`, `resetGraphText`, `spikeAt`, `rowAt` and the cause palette `CAUSE_STYLE`: renderView keeps no copy) and `perf/graph/themes` (`graphLook`, `causeHue`, `GRAPH_PALETTES`: the light and dark looks stay out of the agent bundle). The recorder's `RecorderStatus` is a type-only re-export of `recorder/types` (`device/contract/recorder.ts`): no recorder code enters the tools bundle.

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Render panel. |
| `onStart` | Starts the session watches (`game.render`, `game.assets`, `game.effects` by manifest; the manifest listener also follows the strip and R4). Recalibrates on a device or orientation change (`workspace.onPrefs`). Re-renders the strip when the computer's engine fingerprint arrives (`link.onEngine`). Runs the `workspace:changed` logic at once when Render is already shown. |
| `onStop` | Stops every watch, the effects watch and the strip's device watches; clears the strip's repaint timers and drops a record read in flight. Removes the overlay root and the palette items. Clears the listeners. |

## Usage

```ts
const app = createApp({ pluginConfigs: { renderView: { fpsSamples: 120, releaseLogMax: 20 } } });
await app.start();
app.workspace.show("render");
await app.renderView.refresh();
app.renderView.snapshot().textures.length; // 3: the textures of the loaded bundles
```

Another view reveals an element without depending on renderView:

```ts
ctx.emit("workspace:reveal", { ref: { kind: "entity", id: 3_145_728 } });
```

## Integration

- **gameView** emits `workspace:reveal` from "Show in render tree" and hooks `workspace:inspect` from "Inspect in Game".
- **workspace** palette: one item per catalogue texture, group "Textures". Running it shows Render, filters to the bundle and reveals the first node that draws the texture.
- **workspace** game frame: the pink box is drawn in renderView's own overlay root, in device space.

## Files

| File | Role |
|---|---|
| `index.ts` | Wiring. |
| `types.ts` | Config, state, rows, tiles, snapshot, api, ctx, hooks. |
| `state.ts` | State factory, `notify`, `subscribe`. |
| `api.ts` | The api over `actions.ts`, `derive.ts`, `watch.ts`. |
| `watch.ts` | Tracker, effects and scene watches, scene builds, calibration, catalogue, refresh. Each entry point resolves link once and passes it down. |
| `derive.ts` | Pure derivations. |
| `format.ts` | Pure tile texts, sparkline points, tags. |
| `guards.ts` | `asRenderStats`, `asAssetsUsage`, `asEffectsStats`. |
| `actions.ts` | Reveal, select, open, sort, filter, highlight, inspect, palette items. |
| `overlay.ts` | The box root in the game frame's overlay. |
| `handlers.ts` | The four hooks. |
| `lifecycle.ts` | onInit, onStart, onStop. |
| `panel.tsx`, `components/` | The Render panel and its Preact components. |
| `styles/` | `render.css` and its `@scope` sheets (no `@layer` wrapper, R7); `strip.css` and `record.css` for the D1 strip, in editor tokens only. |
| `device/types.ts` | The strip's state, record state, view, text runs, cells and record rows. |
| `device/state.ts` | The strip's state factory and its reset on a session change. |
| `device/derive.ts` | Pure: `stripView`, the about line, build profile, STALE, seen, REC clock, rate suffix, link cell, headline, More. |
| `device/step.ts` | Pure: prev / next over the window's spikes, the `n/total` counter. |
| `device/record.ts` | Pure: the rows of the record side panel. |
| `device/guards.ts` | Shape guards of the device values. |
| `device/watch.ts` | Which sessions get the strip, the device watches, the record read, the strip's api actions. |
| `device/paint.ts` | The canvas's interpolated `requestAnimationFrame` loop (4 Hz steps under reduced motion), its cached base layer, the theme repaint and the canvas click. |
| `device/colour.ts` | Pure: the graph's colours as CSS `light-dark()` for the DOM (`themedHue`, `themedColour`). |
| `device/contract/` | The barrel of the perf contracts the strip reads (`perf/protocol`, `perf/graph`, and `perf/graph/themes` for the light and dark looks, which only the tools page imports) and the recorder's `RecorderStatus` (a type-only re-export of `recorder/types`). |
| `device/components/` | `DeviceStrip`, `DeviceRow`, `StripGraph`, `SpikePanel`, `Legend`, `Annunciator`. |

## Narrow layout

The Render workspace is the inline-size container `render`.

| Container width | Tiles grid | Card columns |
|---|---|---|
| ≥ 560 px | 6 columns, 3 at a viewport ≤ 1380 px | 2: tree and textures left, bundles, pools and release log right |
| < 560 px | 2 columns | 1: the left column above the right |
| < 380 px | 1 column | 1 |

The render tree header wraps: Expand all and Collapse are one group that moves onto its own line, and the counts shrink (`min-inline-size: 0`).

The D1 strip is the inline-size container `device-strip`. Below 900 px of its width the main grid is one column and the
record panel moves under the graph (full width, `max-block-size: 320px`, its details scroll); the device row and the
headline wrap. The graph row stays 200 high and the nav column 44 wide. No horizontal scroll at any width.

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| No render phase split, no per-pool counts. | F-R1. Particles, emitters, filters and render passes come from `game.effects` since game 0.0.3. The JS heap comes from the page heartbeat. |
| Texture rows come from the committed asset manifest. Without one the card says so. Texture use is approximate. | F-R2: `game.textures` with size and last use per texture. |
| The release log is a diff. Its frame is approximate ("≈fN"). No reason. | F-R3: `assets:bundle-unloaded` with frame and reason. |
| Tree types are ui tags and entity display kinds, not Pixi classes. | F-G1: a display-tree source. |
| Draw calls are counted in a dev build only. | None. |
