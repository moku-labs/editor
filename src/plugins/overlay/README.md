# overlay

> Complex tier, agent core (`createAgentPlugin`). A default plugin of `@moku-labs/editor/agent`.

The editor's window over a running game, on a phone without a dev server or on a dev page. Three modes: **hidden**
(nothing drawn), **pill** (fps now, spikes in the last 6 s, link light, REC; a tap opens the card) and **card** (docked
to the left or right edge, dragged by its grip, snapped to the nearer edge inside the safe area). The card has four
tabs on a key bar: **Frames** (the frame graph of the last 6 s painted by `perf/graph`, prev / next spike keys, six
counters, a More disclosure, the spike record), **Game** (only the commands the game marked for the overlay), **Record**
(the device log through `recorder`: off until someone records, and who started it) and **Link** (the device link the
bridge reports). It shows the engine fingerprint
and the build on the Frames tab, and STALE when the phone's engine differs from the computer's. It remembers place,
mode and tab on the device.

It opens however the game decides: the engine calls the global channel `globalThis.__MOKU_GAME_OVERLAY__` the overlay
sets at start (`app.debug.overlay.*`, `config.debug.overlay`, `DebugTrigger`). The editor ships no gesture and no debug
button of its own.

**The overlay must not cause the stutter it measures** (§ Cheapness): opaque surfaces, one plot canvas and one fixed canvas, numbers and canvas
change at most four times a second, no animation loop, one 120 ms slide, and all of its work between
`monitor.beginAgent()` and `monitor.endAgent()`, so the engine charges it to the `agent` phase.

## Folders

| Folder | Holds |
|---|---|
| (root) | `index.ts` (wiring), `types.ts`, `state.ts`, `api.ts`, `modes.ts` (the modes and the tab), `handlers.ts`, `context.ts`, `command.ts` (`editor.overlay`), `lifecycle.ts`, `channel-global.ts`, `actions.ts` (what input does) |
| `place/` | `dock.ts` (size, range, top, snap; pure), `drag.ts` (grip and arrow keys), `safe-area.ts` (probes and perf's insets), `layout.ts` (the host's custom properties), `store.ts` (localStorage) |
| `model/` | Pure view models: `header.ts`, `frames.ts`, `record.ts`, `game.ts`, `record-tab.ts`, `link.ts`, `format.ts`, `types.ts` |
| `paint/` | `tick.ts` (the agent bracket, the tick, visibility), `graph.ts` (the `perf.readWindow` visitors, the canvas), `render.ts` (inputs → view model → Preact) |
| `fonts/` | The three woff2 faces and `OFL.txt`, `faces.ts` (generated base64), `register.ts` |
| `styles/` | The one stylesheet as text: `index.ts` assembles `tokens`, `host`, `legend`, `pill`, `card`, `frames`, `record`, `tabs` |
| `view/` | Preact components (`Overlay`, `Pill`, `Card`, `Header`, `KeyBar`, `EngineLine`, `Legend`, `FramesTab`, `GraphWell`, `Counters`, `SpikeRecord`, `GameTab`, `RecordTab`, `LinkTab`, `Toast`, `icons`) |

None of the folders is a plugin: one `createAgentPlugin` call, no own lifecycle or events below the root.

## Configuration

Set through `pluginConfigs.overlay`. Defaults from `index.ts`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"hidden" \| "pill" \| "card"` | `"hidden"` | Mode at start when the device remembers none (or `remember` is false). The engine's `config.debug.overlay` opens the window later through the global channel. |
| `dock` | `"left" \| "right"` | `"right"` | Edge the window docks to until the person drags it. |
| `remember` | `boolean` | `true` | Remember place, mode and tab in `localStorage["moku-editor:overlay"]`. |
| `mount` | `string \| undefined` | `undefined` | CSS selector of the element the host is appended to; `undefined` = `document.body`. |

```ts
createApp({ pluginConfigs: { registry: { game }, overlay: { mode: "pill", dock: "left" } } });
```

`onInit` checks the values (two-line `TypeError`s, e.g. `[moku-editor] overlay.dock is "top".` / `  Use "left" or
"right".`) and refuses the old keys: `corner` (`… was replaced by overlay.dock …`) and `open` (`… was replaced by
overlay.mode …`).

Constants in `types.ts`: `PAINT_MS` 250 (the tick), `SLIDE_MS` 120, `TOAST_MS` 3000, `CARD_W` / `CARD_W_COMPACT`
344 / 300 (compact below `COMPACT_BELOW` 384), `CARD_H` / `CARD_H_MIN` 372 / 240, `PILL_W` / `PILL_H` 138 / 36,
`EDGE_GAP` 8, `DRAG_SLOP` 4, `KEY_STEP` 16, `STORE_KEY` `"moku-editor:overlay"`, `Z_INDEX` `2_147_483_000`,
`HOST_ATTRIBUTE` `"data-moku-editor-overlay"` (from the protocol; the bridge's tap watch skips events from it).

## API

`app.overlay` is an `OverlayApi` (contracts and examples on the type in `types.ts`).

| Member | Does |
|---|---|
| `open({ mode?, tab? })` | Shows the card (or the pill with `{ mode: "pill" }`); `tab: "game"` falls back to Frames without overlay commands. Slides in once when it was hidden, or from the pill to the card. Emits `overlay:changed` when the mode or the tab changed. Before start it records the mode; `onStart` applies it over the remembered one. |
| `close()` | Hides the window: nothing drawn, no tick. Emits `overlay:changed` when it was visible. |
| `toggle()` | Hidden → the last visible mode (the card by default); pill or card → hidden. |
| `isOpen()` | True for the pill and the card. |
| `mode()` | `"hidden"`, `"pill"` or `"card"`. |
| `commands()` | The game's commands marked `overlay: "toggle" \| "button"`, in manifest order, a toggle's value read now, `allowed` and the refusal `reason`. Empty: no Game tab. |

```ts
editor.overlay.open({ mode: "pill" });
editor.overlay.mode(); // "pill"
editor.overlay.toggle(); // hidden
```

### The global channel

`onStart` sets and `onStop` deletes (only when it still holds this overlay's object, so a second agent keeps its own):

```ts
globalThis.__MOKU_GAME_OVERLAY__ = { open({ mode }), close(), toggle(), isOpen() };
```

`open({ mode: "pill" })` opens the pill; any other mode opens the card. The engine maps `config.debug.overlay` to
`open({ mode })` right after `startAgents`; the overlay never reads that setting itself.

### Registry command

Added in `onInit`, so the manifest has it before start.

| Id | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.overlay` | `Overlay in game` | `{ mode: "string" }` | `cosmetic` | `{ mode }`, the mode after the call |

`"hidden"` closes, `"pill"` and `"card"` open; any other string is refused with -32602
`[moku-editor] editor.overlay: mode must be "hidden", "pill" or "card".` / `  Run it with { mode: "card" }.`
(`{ reason: "invalid_input", field: "mode" }`); the old `{ on }` is refused with `on is not a known input`. Its `state`
is `registry.envelope()`.

```ts
await link.run("editor.overlay", { mode: "pill" });
// { value: { mode: "pill" }, state: { path: "garden/boss", frame: 4812, tainted: false } }
```

## Game and Record tabs

**Game.** A row's `allowed` comes from the registry's build profile (`refusalOf(profile, effect)`): a `--debug` build of
an engine that includes control (`__MOKU_GAME_CONTROL__`, profile `full`) allows every marked command, so nothing is
greyed and a press runs in the page through `channel.run`, offline too. A `read` profile means an engine from before
that (its `--debug` had no control) or a deliberate `--debug=read` build; the words name both:

| Where | Words |
|---|---|
| A refused row's second line and `title` (`read-only`) | `needs a debug build of a newer engine, or without --debug=read` |
| A refused row (`dev-only`) | `needs a dev or debug build` |
| The note under `READ-ONLY` | `This build only reads. Commands run on --debug builds of @moku-labs/game {CONTROL_ENGINE} or newer (not --debug=read).` |
| The toast of a press refused -32009 `read_only` | `{title} needs a debug build of a newer engine.` |

`CONTROL_ENGINE` (`model/game.ts`) is the engine release whose `--debug` includes control: the pinned engine, `0.15.1`.

**Record.** The recorder starts no log by itself. Idle, the top row reads `OFF` with `Nothing is saved until you
record.` / `The editor or an agent can start it too.` Start calls `recorder.start({ by: "phone" })`, so the tools page
shows the log as started on the phone. While a log runs, the first info line holds the numbers and the second who
started it, from `recorder.status().startedBy`:

| `startedBy` | Line |
|---|---|
| `{ by: "phone" }` | `started here` |
| `{ by: "editor" }` | `started from the editor` |
| `{ by: "agent", name: "Claude" }` / `{ by: "agent", name: null }` | `started by an agent (Claude)` / `started by an agent` |
| `{ by: "remote" }` | `started from the computer` |
| `{ by: "code" }` | `started by the game` |
| `{ by: "auto" }` | `started on launch` |

An agent's name longer than 12 characters is cut to 11 and an ellipsis; a line wider than the row ends in an ellipsis.
Stop and Add mark stop and mark any log, whoever started it. A log started or stopped elsewhere shows at the next tick;
the header's REC follows `state` whatever the origin.

**Smooth scroll on the device.** The plot's compositor slide is checked on a real phone, not by a unit test (spec 08
Delta 2026-10-16 O3): on the A26 by wire, `chrome://inspect` → Performance, 10 s of the expanded card on the Frames tab
— the graph moves continuously (one `transform` transition per 250 ms paint), at most four overlay paints a second, no
long task from the overlay, and steps without a transition under reduced motion. The result is recorded in
`.planning/e2e/`.

## Events

| Direction | Event | Payload | When |
|---|---|---|---|
| Emitted | `overlay:changed` (global, `AgentEvents`) | `{ mode, tab }` | Every mode or tab change, once at a visible start. Never on a place change. The recorder logs it as the monitor event `devtools`. |
| Emitted | `overlay:connect` (global, `AgentEvents`) | `{ address }` | Connect / Pair on the Link tab with a valid `host:port`. The bridge dials it. |
| Hooked | `bridge:status` (global) | `{ status, session?, link? }` | Stored; the next tick shows it. |
| Hooked | `recorder:status` (the recorder's own event, through `depends`) | `RecorderStatusEvent` | Stored; the next tick shows it. |

Why the two emitted events are global: `overlay:changed`'s listener, the recorder, is a dependency of the overlay (a
per-plugin event would need recorder → overlay, a cycle); `overlay:connect`'s listener, the bridge, is opt-in and the
overlay must not depend on it.

Log events: `overlay:mount-missing` `{ mount }` (warn), `overlay:no-dom` (warn), `overlay:paint-failed` `{ message }`
(warn, once), `overlay:command-failed` `{ id, code, message }` (warn), `overlay:storage-failed` `{ message }` (debug,
once), `overlay:fonts-unavailable` (debug).

## Dependencies

| Kind | Name | Used for |
|---|---|---|
| `depends` | `registryPlugin` | `add` (`editor.overlay`), `envelope`, `manifest` (overlay commands, the game's name), `command(id).value()`, `build()` (engine line, profile, STALE) |
| `depends` | `channelPlugin` | `run(id, input, "overlay")` for a Game tab press |
| `depends` | `perfPlugin` | `status`, `readWindow` (visitors made once), `second`, `spike`, `monitor` (the agent bracket) |
| `depends` | `recorderPlugin` | `status` (the Record tab and its origin line), `start` (`{ by: "phone" }`), `stop`, `mark`, `command` (the auto mark of a press), `marks`, `files`, `share`, `remove` |
| Presence | `ctx.has("bridge")` | The Link tab's no-bridge state; no import of `bridgePlugin` |

Pure modules: `perf/graph`, `perf/protocol`, `hub/protocol` (`parseAddress`, `isLoopback`, `DeviceLink`; never the hub
index, `hub-import.test.ts`) and `registry/protocol`.

## Cheapness

| # | Rule |
|---|---|
| C1 | No `backdrop-filter`, `filter`, blur, opacity, alpha colour or transparent ground; shadows without blur. |
| C2 | Every surface resolves to an opaque token. |
| C3 | One plot canvas and one fixed canvas, the same elements across ticks, only while the Frames graph shows; both painted once per tick in the same bracketed paint. Only the plot slides (one `PAINT_MS` linear compositor transition per paint, none under reduced motion): what is tied to time (rows, budget lines, flags, the axis's seconds). The fixed canvas lies over the whole well on a transparent ground and stays: what marks a place (the tape with its budget bug and readout, the caption, `now`, the stack legend). |
| C4 | One `setInterval(PAINT_MS)`; data between ticks is stored, not rendered; the painter at most once a tick and only for a changed window; the backing store resized only on a size or dpr change. |
| C5 | No `requestAnimationFrame`, no `infinite`, only the two slide keyframes. |
| C6 | One 120 ms slide on an opening; reduced motion removes it. |
| C7 | Hidden: host `hidden`, no interval, no canvas. |
| C8 | Every render and paint between `beginAgent()` and `endAgent()`, the end also after a throw. |
| C9 | A hidden page stops the tick; visible restarts it. |

The window of perf is read only inside the visitors handed to `perf.readWindow`; the overlay keeps frame numbers.

## Place

The host is `position: fixed` with `data-dock`, and `--overlay-top`, `--overlay-side`, `--overlay-w`, `--overlay-h` on
its inline style, written on a mode change, a drag end, a resize or an inset change. The window keeps 8 px from the top
and bottom safe insets; the safe area is the larger of the `--moku-safe-*` / `--moku-device-safe-*` / `env()` probes and perf's display insets,
re-read on `resize`, `moku-native:insets` and a probe resize. A drag moves the host by transform only; the release snaps
to the nearer edge and writes the store. The grip is a button: arrow keys up and down move by 16 px, left and right
pick the edge.

## Fonts

Three faces live in `fonts/` with `OFL.txt` (SIL OFL 1.1): `barlow-condensed-latin-600.woff2`,
`barlow-condensed-latin-500.woff2`, `barlow-latin-500.woff2`. `bun run fonts:overlay` (`scripts/overlay-fonts.ts`) cuts
each from the fontsource Latin woff2 (`@fontsource/barlow`, `@fontsource/barlow-condensed` 5.3.0) with HarfBuzz
(`subset-font`) down to printable ASCII plus every printable non-ASCII character the overlay, the graph painter,
perf's cause words and why sentences and the tools strip print (today NBSP and § ° ± · × – — … → − ≥). It writes the
files and `faces.ts` (base64 and `GLYPHS`; generated). `fonts.test.ts` fails when a source prints a glyph outside
`GLYPHS` or `faces.ts` is stale. Full Latin-1 was measured over the agent's 120 KB bound, so a game's accented text
falls back to the stack's next family.

`fonts/register.ts` adds the faces to `document.fonts` under private families, `"Moku Overlay Barlow Condensed"` and
`"Moku Overlay Barlow"`, so a game's own Barlow never draws from this subset; the overlay's stacks name them first
(`--font-cond`, `--font-text`). Registration happens at the first visible mode, inside the agent bracket; the graph's
legends are measured again once the faces load; stop deletes them. The tools page loads none of them (spec 09 Delta
2026-10-15: it is set in Geist); this folder is their one home.

Size: 43 424 bytes of woff2, 58 788 bytes of `faces.ts`; the dev agent bundle is 110,705 bytes gzip with them (265,098 bytes minified), measured by `tests/integration/agent-bundle.test.ts`: `Bun.build` of the README's dev entry for the browser, minified, `__MOKU_GAME_DEV__` defined `true`, the game itself external; the test fails above 120,000 bytes gzip.

## Migration

| From | To |
|---|---|
| `pluginConfigs.overlay.corner` | `dock: "left"` (top-left / bottom-left) or `dock: "right"` |
| `pluginConfigs.overlay.open: true` | `mode: "card"` (or `"pill"`), or the game's `config.debug.overlay` |
| `editor.overlay { on: true / false }` | `{ mode: "card" }` / `{ mode: "hidden" }` |
| The one-click cheat buttons | Mark the command in the game's `.dev` module: `overlay: "button"` (or `"toggle"` with `input: { on: "boolean" }` and `value(app)`) |
| Custom agent compositions | Compose `[registryPlugin, channelPlugin, perfPlugin, recorderPlugin, overlayPlugin]` |
