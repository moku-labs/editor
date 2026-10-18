# registry

> Complex plugin (agent core). The only place where the editor touches the game's doors.

It wraps every source and command of `@moku-labs/game/inspect` and `@moku-labs/game/control`,
the game's `.dev` modules and the editor's own commands and sources (`editor.*`) into closure-erased
entries: raw `Json` in, checked input to the door, wire-safe `Json` out. It builds the
`Manifest` the bridge sends in `hello`, with the page's build and, on every command, whether this
build runs it. Every command run emits the registry's own event `registry:command`. It also owns the runtime-free protocol module
`./protocol`, which the server, tools and agent plugins import.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `game` | `GameLike \| undefined` | `undefined` | Required. The app the game made with `createApp`. `onInit` throws without it, so `createApp` throws. |
| `modules` | `readonly DevModule[]` | `[]` | The game's `.dev` modules: extra sources and commands, added after the doors. |
| `name` | `string \| undefined` | `undefined` | `Manifest.game`. Falls back to the trimmed `document.title`, then `"game"`. |

```ts
createApp({ pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } } });
```

`onInit` checks the config:

| Case | Error |
|---|---|
| `game` is `undefined` | `[moku-editor] registry.game is missing.` |
| `game.time.snapshot`, `onFrame`, `isPaused` or `game.flow.state` is not a function | `[moku-editor] registry.game is not a game app.` |
| Two entries share an id (sources and commands are one namespace) | `[moku-editor] Duplicate registry id "<id>".` |
| Bad id, input kind, `changes` or `effect` | `[moku-editor] Registry id "<id>" is not a dotted name.` and the kind, changes, effect messages |
| A command's `overlay` is not `toggle` or `button` | `TypeError`: `[moku-editor] Command "<id>" has an unknown overlay "<value>".` |
| An overlay toggle without `value(app)` | `TypeError`: `[moku-editor] Command "<id>" is an overlay toggle without value(app).` |

Order in the manifest: door entries, then modules in config order, then `editor.toggles` (only when
the game has an overlay toggle), then editor sources and commands in `add` order.
Module commands may have any effect, `cheat` and `raw` included.

## API

`app.registry` or `ctx.require(registryPlugin)` gives `RegistryApi`.

| Method | Returns | Notes |
|---|---|---|
| `manifest()` | `Manifest` | Frozen. Descriptors only, cached until the next `add`. `game`, `page`, `embedded` are read at call time. `panels` is omitted. Each build probes the door sources and the editor sources with a probe first (see "Sources the game does not have"). Every command carries `allowed` (and `reason` when refused); the manifest carries `build`. |
| `source(id)` | `SourceEntry \| undefined` | Door, module, registry or editor source. `undefined` for an unknown id. The caller maps it to -32601 `unknown_id`. |
| `command(id)` | `CommandEntry \| undefined` | Door, module or editor command. An overlay toggle's entry has `value()`. |
| `add(entry)` | `void` | Adds an editor command (`descriptor`, `run`) or an editor source (`descriptor`, `read`, `watch`, `probe?`; told apart by `read`). Call it in `onInit`. |
| `envelope()` | `RunState` | `{ path, frame, tainted }` for editor commands that run no door. |
| `clock()` | `Clock` | `{ frame, paused, held, reasons }` from the game clock and its pause stack. The channel heartbeat reads `frame` and `paused`; the reload checkpoint reads `held`. |
| `game()` | `GameLike` | The configured game app, for an editor plugin that reads the engine directly (perf reads the renderer monitor). Throws the missing-game error without one. |
| `build()` | `BuildInfo` | `{ profile, id?, engine?, appId? }` of this page (see "Build profile and allowed commands"). Read once; the flags of a page never change. |

```ts
registry.manifest().commands.length; // 21 door commands + module + editor commands
registry.source("game.history")?.read({ last: 1 }); // [{ path: "home", outcome: "play", … }]
await registry.command("game.step")?.run({ frames: 1 }); // { value: { frame: 1841, … }, state: { … } }
registry.envelope(); // { path: "board/awaitIntent", frame: 1840, tainted: false }
registry.clock(); // { frame: 1840, paused: false, held: false, reasons: [] }
registry.build(); // { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" } on a --debug build
```

### `Clock`

| Field | Type | Meaning |
|---|---|---|
| `frame` | `number` | The frame of the game clock. |
| `paused` | `boolean` | The clock does not run, for any pause reason (`game.time.isPaused()`). |
| `held` | `boolean` | The developer holds the pause: `reasons` include `"devtools"`, the reason `game.pause` pushes. This is the pause a reload restores. |
| `reasons` | `readonly string[]` | A copy of `game.lifecycle.reasons()`, in push order. |

`GameLike.lifecycle` is optional. A game without `lifecycle.reasons` answers `reasons: []` and
`held` equal to `paused`. The heartbeat on the wire keeps two fields, `frame` and `paused`.

```ts
registry.clock(); // the game tab is hidden: { frame: 1840, paused: true, held: false, reasons: ["background"] }
await registry.command("game.pause")?.run(null);
registry.clock(); // { frame: 1840, paused: true, held: true, reasons: ["background", "devtools"] }
```

### Entries

| Member | Signature | Behaviour |
|---|---|---|
| `SourceEntry.descriptor` | `SourceDescriptor` | Fresh frozen `{ id, title, input, changes }`. Never the door object. |
| `SourceEntry.read` | `(raw: Json) => Json` | Availability, `checkInput`, the door read, `toWireValue`. `null` means no input. |
| `SourceEntry.watch` | `(raw: Json, fn: (value: Json) => void) => () => void` | Checks availability and the input now. Delivers on the next frame, not at once. Returns the door's unsubscribe (idempotent). |
| `SourceEntry.probe?` | `() => string \| undefined` | Editor sources only, given to `add`: why the source is not available now. The registry runs it at each manifest build; the stored copy has none. |
| `CommandEntry.descriptor` | `CommandDescriptor` | Fresh frozen `{ id, title, input, effect, overlay?, allowed, reason? }`. |
| `CommandEntry.run` | `(raw: Json, via?: CommandVia, client?: string) => Promise<RunResult>` | Async. Never throws synchronously. Door and module commands go through the game's `run` (dev guard, cheat journal). `via` names who ran it for `registry:command` (absent: `"local"`); `client` is the MCP client's name the hub stamped, passed only with `via: "mcp"`. The registry's wrappers hand both to the entry, so an editor command added with `add` (the recorder's `editor.record`) reads who started it. An entry written with two parameters (or one) stays assignable and ignores them. |
| `CommandEntry.value?` | `() => boolean \| undefined` | Overlay toggles of the game only: `door.value(game)` now; `undefined` when it threw or answered no boolean. |

A watch never throws into the game's frame loop. A door read error, a `toWireValue` error or a
listener error is caught and logged once per streak. The next good delivery ends the streak.

### Build profile and allowed commands

The registry reads the page's build flags once per descriptor build, from `globalThis` (no engine
import; a string `"true"` is not a flag): `__MOKU_GAME_DEV__` gives `dev`, else
`__MOKU_GAME_CONTROL__` gives `full`, else `__MOKU_GAME_AGENT__` gives `read`, else `none`.
`__MOKU_GAME_BUILD__`, `__MOKU_GAME_ENGINE__` and `__MOKU_GAME_APP__` give `build.id`,
`build.engine` and `build.appId` when they are strings. `appId` is the app id the engine also writes
as the PerfLog header's `app.id` (the bundle identifier, with the `.debug` suffix of a native debug
install); an engine before it (0.15.0) sets none and `appId` is absent. The bridge sends it in its
`pair`, so the editor can tell two phones of one model apart. Each door and module command gets `allowed` by `refusalOf(profile, effect)` (spec 10 C1):

| profile | `read`, `cosmetic` | `route`, `cheat`, `raw` |
|---|---|---|
| `"dev"` | run | run |
| `"full"` (`--debug=full`) | run | run |
| `"read"` (`--debug`) | run | `allowed: false, reason: "read-only"` |
| `"none"` (no flag) | `allowed: false, reason: "dev-only"` | `allowed: false, reason: "dev-only"` |

Editor commands are allowed on every build (`editor.reload`, effect `route`, keeps working on a
phone's `--debug` build): they run no door. `allowed` is advice for panels, the overlay and MCP; the
registry never refuses a run because of it. The engine's `run` decides, and its refusal reaches the
caller: an error tagged `reason: "read-only"` (the engine's `controlReadOnly`) rejects -32009
`read_only`, one tagged `reason: "dev-only"` (the engine's `controlRefused`: a door body on a page
without the dev or debug flag) rejects -32009 `dev_only`; both log `registry:command-refused` at info.

```ts
app.registry.manifest().commands.find(command => command.id === "game.tap");
// { id: "game.tap", title: "Tap", input: { key: "string?", target: "json?" }, effect: "route", allowed: false, reason: "read-only" }
```

### Overlay commands

A door or module command may carry `overlay: "toggle" | "button"` (engine spec 12 H4.4); the
descriptor copies the marker, never `value`. A toggle must have `value(app)`. Its entry's `value()`
asks it at call time; a throw or a non-boolean answer gives `undefined` and one
`registry:value-failed` warn per streak. The editor ships no overlay command of its own: `add`
refuses the marker on an editor command (decision "No built-in debug buttons").

When the game has at least one toggle, the registry adds the source `editor.toggles` (origin
`"registry"`, `changes: "frame"`, never probed, rebuilt on every catalogue build) right after the
module sources. Its read answers `{ [id]: boolean | null }` for every toggle in catalogue order,
`null` when the toggle's `value()` failed. A game without toggles has no such source.

```ts
app.registry.command("garden.glow")?.value?.(); // true
app.registry.source("editor.toggles")?.read(null); // { "garden.glow": true, "garden.fog": null }
```

### Editor sources

`add` takes an editor source (`editor.perf.*` of perf) next to editor commands. It checks the
descriptor like a door source and stores a guarded frozen copy with a fresh descriptor
(`available` / `reason` given by the owner are dropped):

| Member | Behaviour |
|---|---|
| `read(raw)` | -32008 `not_installed` while the probe says so, without calling the owner; else the owner's read through `toWireValue`. A `ProtocolError` passes unchanged; any other throw logs `registry:source-failed` and becomes -32000 with the id. |
| `watch(raw, fn)` | -32008 the same way; else the owner's watch with a guarded listener: `fn` gets wire values, and a throw of the conversion or of `fn` is logged `registry:watch-failed` once per streak, never rethrown into the owner's timer. A synchronous throw of the owner's watch is mapped like `read`. |
| probe | When the entry gives `probe`, the registry runs it at each manifest build: an answer lists the source `available: false` with that reason (one `registry:source-unavailable` info), `undefined` makes it available again, a throw counts as unavailable with its first line. |

A rebuild of the catalogue keeps editor sources and their probes, as it keeps editor commands.

### Sources the game does not have

A game can lack the plugin behind a door source: a merge game without `effectsPlugin`, a
screenless game without `ui`, `world` or a renderer. The registry probes every door source once
with its default input (`{}`) each time it builds the manifest: at `onStart` (the editor starts
after the game) and after every `add` that dropped the cache. A door that throws is not installed:

| Where | What |
|---|---|
| Manifest | The descriptor gains `available: false` and `reason` (the first line of what the door threw). An available source has neither key. |
| `read`, `watch` | Throw -32008 `not_installed`, not retryable: `[moku-editor] source <id> is not available in this game: <reason>`. No door call, no warn. |
| Log | One `registry:source-unavailable` info `{ id, reason }` when a source turns unavailable; none per read. |

A source with a required input, the element locators of `UNPROBED_SOURCES` (`game.rect` of game
0.1 and `game.locate` of game 0.4, which throws on `{}`) and every module source are never probed.
The next build probes again: a source that answers is available again.

Game 0.4.2 makes its opt-in sources throw when their plugin is missing, for example
`[game] The source game.sounds needs audioPlugin.`. The probe lists them as not installed with that
first line as the reason.

```ts
await editor.start(); // probes the door sources
editor.registry.manifest().sources.find(source => source.id === "game.effects");
// { id: "game.effects", title: "Effects", input: {}, changes: "frame", available: false, reason: "Cannot read properties of undefined (reading 'stats')" } in Chromium
editor.registry.source("game.effects")?.read(null); // throws -32008 not_installed
```

### `add` rules

| Rule | Error |
|---|---|
| Id matches `ID_PATTERN` and has at most 128 characters | `[moku-editor] Registry id "<id>" is not a dotted name.` |
| Id is not used by any source or command | `[moku-editor] Duplicate registry id "<id>".` |
| `effect` is not `cheat` or `raw` | `[moku-editor] Editor command "<id>" cannot have effect "<effect>".` |
| An editor command carries no `overlay` (checked first) | `TypeError`: `[moku-editor] Editor command "<id>" cannot set overlay.` |
| Every input kind is one of the 8 kinds | `[moku-editor] Command "<id>" has an unknown input kind "<kind>" for "<field>".` |
| A source's `changes` is `frame`, `commit` or `edge` | `[moku-editor] Source "<id>" has an unknown changes "<changes>".` |

The stored entry is a guarded copy. Its `run` turns any error that is not a `ProtocolError` into
-32000 `command_failed` with the id. The editor command checks its own input and builds its
`state` with `envelope()`. An `add` after start reaches the tools page only on the next bridge `hello`.

```ts
registry.add({
  descriptor: { id: "editor.overlay", title: "Overlay in game", input: { mode: "string" }, effect: "cosmetic" },
  run: async raw => {
    const { mode } = checkInput({ mode: "string" }, raw); // "hidden" closes, "pill" and "card" open
    return { value: { mode }, state: registry.envelope() };
  }
});
```

### Errors of the entries

| Case | Code | Message |
|---|---|---|
| Bad input | -32602 `invalid_input` | `[moku-editor] game.step: frames must be a number` |
| A source door threw | -32000 `command_failed` | `[moku-editor] <id>: <door message>` |
| A command door threw | -32000 `command_failed` | `[moku-editor] <id>: <first line of the door message>` |
| The value is not JSON | -32006 `not_json` | `[moku-editor] test.leaky: function is not JSON at $.fn` |
| The source is not installed in this game | -32008 `not_installed` | `[moku-editor] source game.effects is not available in this game: <reason>` |
| The page's build refuses the command (the engine's `controlReadOnly`, `reason: "read-only"`) | -32009 `read_only`, not retryable | `[moku-editor] <id>: refused by this debug build, which runs read and cosmetic commands only.` and `  Build the game with --debug=full to run it.` |
| A page without the dev or debug flag refuses the command (the engine's `controlRefused`, `reason: "dev-only"`) | -32009 `dev_only`, not retryable | `[moku-editor] <id>: refused by this build, which has neither the dev nor the debug flag.` and `  Run the game from the dev server, or build it with --debug.` |

Logs (`ctx.log.warn`, payload `{ id, message }`, unless noted):

| Event | When |
|---|---|
| `registry:source-failed` | A source door threw in `read`. |
| `registry:command-failed` | A command door rejected in `run`. |
| `registry:watch-failed` | A watch failed inside a frame. Once per streak. |
| `registry:source-unavailable` | Info, payload `{ id, reason }`: the probe found a door or editor source not available. Once per source while it stays so. |
| `registry:command-refused` | Info, payload `{ id, reason: "read-only" \| "dev-only" }`: the build refused a command (-32009). |
| `registry:value-failed` | An overlay toggle's `value(app)` threw or answered no boolean. Once per streak. |
| `registry:emit-failed` | A hook of `registry:command` threw; the caller's result is unchanged. |

## Events

The registry hooks none. It declares one per-plugin event in `index.ts` (not in `AgentEvents`): only
a plugin with `depends: [registryPlugin]` can hook it.

| Event | Payload | When |
|---|---|---|
| `registry:command` | `RegistryCommandEvent { id, input, via, ok }` | A command run settled. |

### The run event

Every command entry the registry hands out (door and module commands, and the guarded copies of
editor commands) is wrapped once: when its run settles it emits `registry:command` with the raw
input (`null` when none), `via` from `run(raw, via)` (`"overlay"`, `"tools"`, `"mcp"`, `"bridge"`, or
`"local"` when absent) and `ok` (true on resolve, false on reject, -32009 included). A run whose input check
refused it (-32602) is not a run and emits nothing. A throwing hook is logged
`registry:emit-failed` and never changes the caller's result. Reads and watches emit nothing.

```ts
await app.registry.command("game.pause")?.run(null, "overlay");
// recorder's hook gets { id: "game.pause", input: null, via: "overlay", ok: true }
```

## Dependencies

| Kind | Value |
|---|---|
| `depends` | None. First plugin of the agent core. |
| Core plugins | `ctx.log` |
| Global events | None. Its own `registry:command` reaches dependents through `depends`. |
| Game imports | `read`, `watch`, `sources` from `@moku-labs/game/inspect`; `run`, `commands` from `@moku-labs/game/control` |

## Usage

From a game's dev entry:

```ts
import { createApp } from "@moku-labs/editor/agent";

const editor = createApp({
  pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } }
});
editor.registry.manifest().sources.length; // 21 door sources + the module's sources
```

From another agent plugin:

```ts
export const pingPlugin = createPlugin("ping", { depends: [registryPlugin], onInit: addPing });
// in addPing: ctx.require(registryPlugin).add({ descriptor, run });
```

A `.dev` module needs no cast:

```ts
const mergeDev: DevModule = { commands: [addCoins, refillEnergy] };
```

## Integration

| Plugin | Uses |
|---|---|
| `channel` | `source`, `command`, `clock` (heartbeat and `status()`). Maps an unknown id to -32601. `run(id, input, via)` passes `via` to the entry. |
| `bridge` | `manifest` (sent in `hello`), `source` (watch over the wire). Runs a hub `run` with `via: "bridge"`. Depends on `registryPlugin` and `channelPlugin`. |
| `capture` | `add` for `editor.capture`, `editor.series`, `editor.seriesStop`; `command`; `envelope`. |
| `overlay` | `add` for `editor.overlay`; `manifest` (the Game tab's overlay commands, `allowed`, `reason`), `command(id).value()`, `build`; `envelope`. Runs with `via: "overlay"`. |
| `perf` | `game` (the renderer monitor), `add` for the `editor.perf.*` sources with a probe. |
| `recorder` | `add`; hooks `registry:command` (one `command` line per run). |

`src/agent.ts` lists `registryPlugin` first: channel and overlay require it.

## Protocol (`./protocol`)

Runtime-free, re-exported from `"."`. Its only import outside itself is the type-only edge to
`hub/protocol` (`EngineInfo`, `SessionDevice`); `hub/protocol` imports nothing back. Imported by `hub`,
`files`, `pages` (server), `link`, `workspace`, `panels` and the views (tools), and the agent plugins.

| Module | Holds |
|---|---|
| `types.ts` | Every wire type and the shared wire shapes (`SessionInfo`, `FileEntry`, `ToolsBoot`, …). |
| `errors.ts` | `ERROR_PREFIX`, `errorCode` (-32008 `notInstalled` included), `ProtocolError`, `wireError`, `isWireError`, `toWireError`, `fromWireError`, `isRetryable`, `isVersionConflict` (-32005: the file changed since it was read), `bareMessage`. |
| `selection.ts` | `isSelectionInfo`, `parseSelectionInfo`, `parseSelectParams`: the checks of the selection wire values, `area`, `items`, `edits` and the `select` `rect` included. Unknown fields are ignored by the guard and dropped by the parsers, inside the items too. |
| `editor-requests.ts` | The checks of the three requests the hub relays to the page next to `select` (change mcp-editor-tools, D-60): `parseDeviceParams`, `parseShowParams`, `parseNodeParams` for the params, `parseDeviceInfo`, `parseShowInfo`, `parseNodeInfo` for the answers, and `WORKSPACE_NAMES`. Params are closed objects: an unknown field or a wrong type answers `undefined`. Answers are read like `parseSelectionInfo`: known fields are checked, unknown fields are dropped, in a preset row too. A parser returns a fresh copy. |
| `check.ts` | `checkInput`, `isJson`. Holds the one boundary cast of the editor. |
| `hash.ts` | `commandsHash(manifest)` (D-37): commands sorted by `id`, the JSON of `[id, effect, input]` per command with `input` keys sorted (plus the `reason` as a 4th element for a command with `allowed: false`), joined with `\n`, FNV-1a 32-bit over the UTF-16 code units, 8 lowercase hex chars. Titles and sources do not count; an all-allowed list (every dev page) hashes as before. The hub stamps it on `SessionInfo.manifestHash`. |
| `build.ts` | `refusalOf(profile, effect)`: the C1 table of "Build profile and allowed commands" (`"read-only"`, `"dev-only"` or `undefined`); `isAllowed(descriptor)`: true unless `allowed: false`, so an older agent's descriptor reads as allowed. |
| `session-choice.ts` | `pickSession(sessions, requested?)`: the one session rule of a game request. The asked id, else the only session, else the one embedded session; `undefined` when none or several fit. An unknown asked id never falls back. Generic over `{ id, embedded }`, so it returns the caller's own type. The hub's `chooseSession` wraps it and throws -32003; the MCP bridge's `chooseSession` uses it as is. |
| `wire-value.ts` | `toWireValue`: `$map`, `$set`, `$error` tags; cycles, depth over 64, functions, symbols and bigint refused. |
| `messages.ts` | `encode`, `decode`, the builders (`request`, `notification`, `success`, `failure`) and the guards. |
| `devices.ts` | The 21 device presets and their rules, shared by workspace and gameView: `DEVICES`, `DEVICE_GROUPS`, `DEFAULT_DEVICE`, `deviceById`, `presetOf`, `isDevicePresetId`, `screenOf`, `resolveDevice`. Types `DevicePresetId`, `Orientation`, `DeviceSize` are in `types.ts`. |
| `overlay-host.ts` | `HOST_ATTRIBUTE`: the marker overlay sets on its host; the bridge's tap watch skips events whose path holds it. |
| `reload.ts` | The two reload signals (U9, U10): `isReloading(status)`, true for the neutral `lost` of an expected reload (`reloading: true`); `isHotSwapEntry(entry)`, a type guard to `HotSwapEntry`, true for the game.log entry of an applied dev hot swap (game 0.5.0: event `ui:hot-swap`, numeric `ts`, `data.file`). A refused swap logs `ui:hot-refused` and the page reloads. The game.log value is the whole trace, so a caller tests its entries. |
| `project.ts` | The project index on the wire (change project-index): `parseProjectState`, `parseFoundList` (strict: one bad map entry or answer rejects the whole value; unknown fields dropped; a `__proto__` key stays a plain entry), `projectDelta(held, next)`, `firstDefinition(state, key)`, `anchorKey(ref, path)`. |

Shapes added in round 2 (R4, R6):

| Type | Fields |
|---|---|
| `Manifest.restored?` | `{ bookmark: string, frame: number }`: the bridge's first hello after it restored its checkpoint across Bun's full reload. `bookmark` is the JSON text of the restored bookmark, `frame` the frame of the page that took it. |
| `HotReload` | `{ hmr: boolean, owner: "bin" \| "server" }`: the hub's editor-channel notification `hotReload`. |
| `DeviceSpec` | Gains `dpr`, `radius`, `group` (`iphone`, `android`, `foldable`, `tablet`, `desktop`), `frame` (`"modern"` \| `"home-button"`, round 2b R9: the bezel gameView draws), `approx?: true`, `fold?: { cover, inner }` of `FoldScreen { w, h, radius }`. `dpr`, `radius`, `group` and `frame` are required: `devices.ts` fills them for the 21 presets. |

Shapes of the selection relay (change selection-hmr-switch, A4, A5, A10, A15):

| Type | Fields |
|---|---|
| `SelectionInfo` | All readonly. `ref` (`SelectionRef`: `{ kind: "ui", path }` or `{ kind: "entity", id }`, the scene's `ElementRef`), `name`, `type`, `at` (`Date.now()` at publish) required. Optional: `key`, `projection`, `rect` (`SelectionRect` in page CSS px, as `SceneNode.rect`), `source { path, line }`, `card` and `crop` (project-relative, in a day folder `<capturesDir>/<yyyy-mm-dd>/`), `line` (the `@moku …` reference), `session`, `frame` (the scene frame; after a pick, the pick frame), `area` and `items` (an area selection, below), `edits` (the pending style edits, below). The readonly `items` make it not assignable to `Json`: senders pass it through `toWireValue`, like a `Manifest`. |
| `SelectionItem` | All readonly. One element of an area selection: `ref`, `name`, `type` required; `key`, `rect`, `source` optional. |
| Area selection (U9) | `type: "area"`, `name: "area"`, `rect` = `area` = the dragged area in page CSS px, `items` = the group roots inside, top to bottom then left to right, at most 40. `ref` = the first item's ref, or `{ kind: "ui", path: "" }` when no element is inside (`items: []`). |
| `StyleEdit` (editor-ui-cleanup, U8) | All readonly. One pending style edit of the selected element: `path` (the style property, dotted for a nested one: `padding.top`), `from` and `to` (`StyleValue`: `number \| string \| boolean`). `SelectionInfo.edits` is the list: `[{ path: "minWidth", from: 556, to: 600 }]`. `parseSelectionInfo` answers `undefined` for a malformed entry (`edits` not an array, an empty or missing `path`, a `from` or `to` that is not a finite number, a string or a boolean) and drops an empty list, so the field is absent when the element has no edits. |
| `PublishParams` | `{ hotReload: HotReload, selection: SelectionInfo \| null, project: ProjectState, engine: EngineInfo, devices: DeviceDirectory, deviceTelemetry: DeviceTelemetry }` (connect's two typed by `connect/protocol`, a type-only edge). `PublishMethod` is its keys. |
| `PictureFormat` | `"jpeg" \| "png"`: the format of a picture on the wire (editor.capture, editor.sheet, a crop). JPEG is the default (D-34). capture, gameView and the MCP bridge use this one type. |
| `SelectParams` | `{ key?: string, ref?: SelectionRef, rect?: SelectionRect, card?: boolean }`. `rect` picks an area like an area drag of the picker and wins over `key` and `ref`. The page treats an absent `card` as `true`. |
| `EditorNotifications`, `EditorRequests` | The editor channel by method, below. `EditorNotificationMethod` and `EditorRequestMethod` are their keys. `RelayedEditorMethod` is the four requests the hub relays to the page. |

```ts
parseSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1, zoom: 2 });
// { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
parseSelectParams({ rect: { x: 0, y: 30, w: 200, h: 60 } }); // an area: every element inside
parseSelectParams({ card: "yes" }); // undefined
```

Shapes of the editor requests `device`, `show` and `node` (change mcp-editor-tools, D-60). All
readonly. Empty params (`device {}`, `show {}`) read the state and change nothing.

| Type | Fields |
|---|---|
| `WorkspaceName` | `"flow" \| "game" \| "render" \| "state" \| "files" \| "console"`: the same members as workspace's `WorkspaceId`, declared here so the protocol imports no plugin type. `WORKSPACE_NAMES` is the list at runtime, in rail order. |
| `DeviceParams` | `{ preset?: string, orientation?: Orientation, folded?: boolean }`. `preset` is any string: the page knows the presets and answers -32602 for an id it does not have. |
| `DevicePresetInfo` | `{ id, name, group, kind, w, h, foldable }`: a row of `DeviceSpec` with the same `id`, `name`, `group` and `kind`, the cover-screen `w` and `h` in portrait, and `foldable` true when the spec has two screens. |
| `DeviceInfo` | `{ preset, orientation, folded, w, h, presets }`. `folded` is always `true` for a preset that is not foldable. `w` and `h` are the game viewport after the change in CSS px, orientation applied. `presets` is a list of `DevicePresetInfo`. |
| `ShowParams` | `{ workspace?: WorkspaceName }`. |
| `ShowInfo` | `{ workspace: WorkspaceName, workspaces: readonly WorkspaceName[] }`: the active workspace after the change and the names a next request can take. |
| `NodeParams` | `{ id: string }`, 1 to 256 chars. |
| `NodeInfo` | `{ id: string, selected: string }`. `selected` is the item key the Flow view focused, e.g. `"main/board>board/merge"` for a node inside a sub-flow. |
| `RelayedEditorMethod` | `"select" \| "device" \| "show" \| "node"`: the requests the hub relays to the editor page. `selection` is not one: the hub answers it itself. |

```ts
parseDeviceParams({ preset: "pixel-8", orientation: "landscape" }); // the same fields, a fresh object
parseDeviceParams({}); // {}: a read
parseDeviceParams({ preset: "pixel-8", zoom: 2 }); // undefined: an unknown field
parseShowParams({ workspace: "settings" }); // undefined: not in WORKSPACE_NAMES
parseNodeParams({ id: "" }); // undefined: 1 to 256 chars
parseNodeInfo({ id: "main/home", selected: "main/home", open: true }); // { id: "main/home", selected: "main/home" }
```

Shapes of the build profile and the overlay (change device-perf-overlay). All optional or additive on
the wire: a tools page or hub of this version reads an older agent's manifest as "everything
allowed, no overlay commands, build unknown"; an older hub ignores the new fields.

| Type | Fields |
|---|---|
| `OverlayMarker` | `"toggle" \| "button"`. |
| `CommandRefusal` | `"read-only" \| "dev-only"`. |
| `BuildProfile` | `"dev" \| "full" \| "read" \| "none"`. |
| `BuildInfo` | `{ profile, id?, engine?, appId? }`, all readonly. |
| `CommandVia` | `"overlay" \| "bridge" \| "tools" \| "mcp" \| "local"`: who ran a command. The bridge turns the hub's `from` into `"tools"` or `"mcp"`; `"bridge"` is a hub that does not say who. Agent-side only, never on the wire. |
| `CommandDescriptor` | Gains `overlay?`, `allowed?` and `reason?`. This registry always writes `allowed`, writes `reason` only with `allowed: false`, `overlay` only when set. |
| `Manifest.build?` | The page's `BuildInfo`. |
| `ErrorReason`, `errorCode` | `"read_only"`, `readOnly: -32009`: a command the page's build refuses, not retryable; `"dev_only"`, `devOnly: -32009` (the same code): a command a page without the dev or debug flag refuses. |

```ts
refusalOf("read", "route"); // "read-only"
isAllowed({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" }); // true: an older agent
```

Shape of the MCP door tools (change mcp-doors, D-37):

| Type | Fields |
|---|---|
| `SessionInfo.manifestHash?` | `commandsHash` of the session's manifest, set by the hub on `hello`. The MCP bridge rebuilds its door tools only when it moves. |

```ts
commandsHash({ ...manifest, commands: [{ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" }] });
// "4f528e73", the same for the same commands in any order
commandsHash({ ...manifest, commands: [] }); // "811c9dc5"
```

Shapes of the project index (change project-index). They mirror the game's types of
`@moku-labs/game/project` field by field; the protocol never imports that subpath.

| Type | Fields |
|---|---|
| `ProjectAnchor` | `path` (root-relative POSIX) required. Optional: `binding`, `key`, `component`, `kind` (`"literal" \| "template" \| "idProp" \| "ident"`), `stem`, `prop` (the prop an idProp value sits on, `id` or `amountKey`). |
| `ProjectFound` | `ProjectAnchor` plus `line` (1-based, read from disk at the call), `range` (`[startLine, startColumn, endLine, endColumn]`, 1-based, end column exclusive), `hash` (sha1 of the bytes; equals a files `version`), `broken?: true` (the file does not parse now: write no style edit). |
| `ProjectMove` | `{ key, from, to }`: a key that left one file for another in one batch. |
| `ProjectChange` | `{ files, moved, removed }` of one watch batch. |
| `ProjectState` | `{ state: "off", reason }`, or `{ state: "on", revision, previous?, manifest?, defs, uses, broken, change? }`. `defs`: every key except `jsx:` to its def paths in def order (a conflict lists both). `uses`: `node:` and `style:` keys with uses to the paths of the uses. `broken`: broken file to its first parse error. Its readonly maps make it not assignable to `Json`: the hub sends it through `toWireValue`. |
| `ProjectDelta` | `{ all, files, moved, removed }`: what a view drops. `all` when either state is off, there was none before, or `next.previous` is not the held revision. |
| `FindParams` | `{ key }`: the files-channel `find` request. Its result is `ProjectFound[]`. |
| `NodeRef` | `{ flow, node }`: a graph node, the `node:<flow>/<node>` key of the index. |

The node to file rule is gone (amendment N1): `nodeFile`, `flowFile`, `kebab`, `parseOverrides`,
`SOURCE_ROOTS`, `SOURCE_OVERRIDES_PATH` and `SourceOverrides` are removed, and
`.moku/editor/files.json` is not read. The index is the only source of code locations.

| Helper | Answers |
|---|---|
| `projectDelta(held, next)` | `all: true` with empty lists on a gap; else the lists of `next.change`, empty when absent. |
| `firstDefinition(state, key)` | The first def path of a key; `undefined` when the index is off or does not know the key. |
| `anchorKey(ref, path)` | `{ kind: "const", name }` and `{ kind: "call", name }` (a style function's call, G2: `name` is `<function>` or `<function>.<property>`) to `style:<path>#<name>`; `{ kind: "text", key }` to `textStyle:<key>`. |

```ts
projectDelta(undefined, arrived); // { all: true, files: [], moved: [], removed: [] }
firstDefinition(link.project(), "node:board/merge"); // "nodes/merge.ts"
anchorKey({ kind: "const", name: "popupScreen" }, "features/ui/popup.tsx");
// "style:features/ui/popup.tsx#popupScreen"
parseFoundList([{ path: "nodes/merge.ts", line: 17, range: [17, 1, 30], hash: "a1" }]); // undefined
```

Editor-channel methods:

| Kind | Method | Params | Result | Between |
|---|---|---|---|---|
| notification | `session` | `SessionParams` | | hub to agents and tools |
| notification | `sessions` | `SessionsParams`: `{ list: SessionInfo[] }`. Each `SessionInfo` carries `id`, `game`, `page`, `embedded`, `connectedAt`, the optional `heartbeat` and the optional `manifestHash` (`commandsHash` of its manifest, set by the hub; old clients ignore it). | | hub to tools |
| notification | `hotReload` | `HotReload` | | hub to tools (published) |
| notification | `selection` | `SelectionInfo \| null` | | editor page to hub, hub to tools (published) |
| notification | `project` | `ProjectState` | | hub to tools (published, from the files event `files:project`) |
| request | `selection` | `{}` | `SelectionInfo \| null` | tools to hub |
| request | `select` | `SelectParams` | `SelectionInfo` | tools to hub, hub to the editor page |
| request | `device` | `DeviceParams` | `DeviceInfo` | tools to hub, hub to the editor page |
| request | `show` | `ShowParams` | `ShowInfo` | tools to hub, hub to the editor page |
| request | `node` | `NodeParams` | `NodeInfo` | tools to hub, hub to the editor page |

A null selection travels as a `selection` notification without params.

Errors of the selection relay:

| Reason | Code | `errorCode` | Retryable | When |
|---|---|---|---|---|
| `no_editor_page` | -32003 | `noEditorPage` | no | No tools connection with `role=page` is open. |
| `page_closed` | -32001 | `pageClosed` | yes | The page closed before it answered. |

Errors of `device`, `show` and `node`, next to the two above:

| Reason | Code | `errorCode` | Retryable | When |
|---|---|---|---|---|
| `invalid_input` | -32602 | `invalidInput` | no | The params fail their parser; `device` names a preset the page does not have (`field: "preset"`); `node` names a node the graph does not have (`field: "id"`). |
| `no_graph` | -32003 | `noSession` | yes | `node` arrived before the Flow view had its first graph. |

Errors of connect's editor methods (`connect.*`, spec 11 C1), next to `invalid_input` for params:

| Reason | Code | `errorCode` | Retryable | When |
|---|---|---|---|---|
| `port_in_use` | -32000 | `commandFailed` | no | `connect.wire` / `connect.network`: the device port is taken (another `moku-editor perf`). |
| `no_lan` | -32000 | `commandFailed` | no | `connect.network`: the computer has no LAN address. |
| `not_owner` | -32007 | `unauthorized` | no | `connect.off`: device mode belongs to `moku-editor perf`. |
| `no_ticket` | -32602 | `invalidInput` | no | `connect.confirm` / `connect.refuse`: no pairing waits with that ticket. |

Game-channel notifications of the agent and their params:

| Method | Params | Sent by |
|---|---|---|
| `hello` | `HelloParams { manifest }` | the bridge, first |
| `heartbeat` | `Heartbeat { frame, paused, at, heap? }`. `heap { usedMb, limitMb }` is the page's JS heap in MB, rounded to 0.1, only where Chromium's `performance.memory` exists. | the channel beat, through the bridge |
| `value` | `ValueParams { sub, value }` | the bridge, per watched source |
| `tap` | `Tap { x, y, at }`: one `pointerdown` in page CSS px of the game document, `at` = the page's `performance.now()` | the bridge, at most one per 50 ms |
| `bye` | none | the bridge, on stop |

## Limits and game follow-ups

| Item | Status |
|---|---|
| Screen-only doors (`game.render`, `game.ui`, `game.capture`) on a headless app | The sources are listed with `available: false` and answer -32008 `not_installed`. The `game.capture` command throws in the door: -32000 `command_failed`. |
| A `frame` source watched in process | One read per frame. The bridge throttles over the wire. |
| `add` after start | The tools page sees it on the next `hello` only. |
| F-T1 `runWith` in `@moku-labs/game/control` | Not needed. The typing spike passes without casts. |
