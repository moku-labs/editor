# registry

> Complex plugin (agent core). The only place where the editor touches the game's doors.

It wraps every source and command of `@moku-labs/game/inspect` and `@moku-labs/game/control`,
the game's `.dev` modules and the editor's own commands (`editor.*`) into closure-erased
entries: raw `Json` in, checked input to the door, wire-safe `Json` out. It builds the
`Manifest` the bridge sends in `hello`. It also owns the runtime-free protocol module
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

Order in the manifest: door entries, then modules in config order, then editor commands in `add` order.
Module commands may have any effect, `cheat` and `raw` included.

## API

`app.registry` or `ctx.require(registryPlugin)` gives `RegistryApi`.

| Method | Returns | Notes |
|---|---|---|
| `manifest()` | `Manifest` | Frozen. Descriptors only, cached until the next `add`. `game`, `page`, `embedded` are read at call time. `panels` is omitted. Each build probes the door sources first (see "Sources the game does not have"). |
| `source(id)` | `SourceEntry \| undefined` | `undefined` for an unknown id. The caller maps it to -32601 `unknown_id`. |
| `command(id)` | `CommandEntry \| undefined` | Door, module or editor command. |
| `add(entry)` | `void` | Adds an editor command. Call it in `onInit`. |
| `envelope()` | `RunState` | `{ path, frame, tainted }` for editor commands that run no door. |
| `clock()` | `Clock` | `{ frame, paused }` from the game clock. Read by the channel heartbeat. |

```ts
registry.manifest().commands.length; // 17 door commands + module + editor commands
registry.source("game.history")?.read({ last: 1 }); // [{ path: "home", outcome: "play", … }]
await registry.command("game.step")?.run({ frames: 1 }); // { value: { frame: 1841, … }, state: { … } }
registry.envelope(); // { path: "board/awaitIntent", frame: 1840, tainted: false }
registry.clock(); // { frame: 1840, paused: false }
```

### Entries

| Member | Signature | Behaviour |
|---|---|---|
| `SourceEntry.descriptor` | `SourceDescriptor` | Fresh frozen `{ id, title, input, changes }`. Never the door object. |
| `SourceEntry.read` | `(raw: Json) => Json` | Availability, `checkInput`, the door read, `toWireValue`. `null` means no input. |
| `SourceEntry.watch` | `(raw: Json, fn: (value: Json) => void) => () => void` | Checks availability and the input now. Delivers on the next frame, not at once. Returns the door's unsubscribe (idempotent). |
| `CommandEntry.descriptor` | `CommandDescriptor` | Fresh frozen `{ id, title, input, effect }`. |
| `CommandEntry.run` | `(raw: Json) => Promise<RunResult>` | Async. Never throws synchronously. Door and module commands go through the game's `run` (dev guard, cheat journal). |

A watch never throws into the game's frame loop. A door read error, a `toWireValue` error or a
listener error is caught and logged once per streak. The next good delivery ends the streak.

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
| Every input kind is one of the 8 kinds | `[moku-editor] Command "<id>" has an unknown input kind "<kind>" for "<field>".` |

The stored entry is a guarded copy. Its `run` turns any error that is not a `ProtocolError` into
-32000 `command_failed` with the id. The editor command checks its own input and builds its
`state` with `envelope()`. An `add` after start reaches the tools page only on the next bridge `hello`.

```ts
registry.add({
  descriptor: { id: "editor.overlay", title: "Overlay in game", input: { on: "boolean" }, effect: "cosmetic" },
  run: async raw => ({ value: checkInput({ on: "boolean" }, raw).on, state: registry.envelope() })
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

Logs (`ctx.log.warn`, payload `{ id, message }`, unless noted):

| Event | When |
|---|---|
| `registry:source-failed` | A source door threw in `read`. |
| `registry:command-failed` | A command door rejected in `run`. |
| `registry:watch-failed` | A watch failed inside a frame. Once per streak. |
| `registry:source-unavailable` | Info, payload `{ id, reason }`: the probe found a door source not installed. Once per source while it stays so. |

## Events

None. The registry emits and hooks no events.

## Dependencies

| Kind | Value |
|---|---|
| `depends` | None. First plugin of the agent core. |
| Core plugins | `ctx.log` |
| Global events | None |
| Game imports | `read`, `watch`, `sources` from `@moku-labs/game/inspect`; `run`, `commands` from `@moku-labs/game/control` |

## Usage

From a game's dev entry:

```ts
import { createApp } from "@moku-labs/editor/agent";

const editor = createApp({
  pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } }
});
editor.registry.manifest().sources.length; // 20 door sources + the module's sources
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
| `channel` | `source`, `command`, `clock` (heartbeat and `status()`). Maps an unknown id to -32601. |
| `bridge` | `manifest` (sent in `hello`), `source` (watch over the wire). Depends on `registryPlugin` and `channelPlugin`. |
| `capture` | `add` for `editor.capture`, `editor.series`, `editor.seriesStop`; `command`; `envelope`. |
| `overlay` | `add` for `editor.overlay`; `manifest` (cheat list); `envelope`. |

`src/agent.ts` lists `registryPlugin` first: channel and overlay require it.

## Protocol (`./protocol`)

Runtime-free, re-exported from `"."`. It imports nothing outside itself. Imported by `hub`,
`files`, `pages` (server), `link`, `workspace`, `panels` and the views (tools), and the agent plugins.

| Module | Holds |
|---|---|
| `types.ts` | Every wire type and the shared wire shapes (`SessionInfo`, `FileEntry`, `ToolsBoot`, …). |
| `errors.ts` | `ERROR_PREFIX`, `errorCode` (-32008 `notInstalled` included), `ProtocolError`, `wireError`, `isWireError`, `toWireError`, `fromWireError`, `isRetryable`, `bareMessage`. |
| `selection.ts` | `isSelectionInfo`, `parseSelectionInfo`, `parseSelectParams`: the checks of the selection wire values, `area`, `items` and the `select` `rect` included. Unknown fields are ignored by the guard and dropped by the parsers, inside the items too. |
| `check.ts` | `checkInput`, `isJson`. Holds the one boundary cast of the editor. |
| `wire-value.ts` | `toWireValue`: `$map`, `$set`, `$error` tags; cycles, depth over 64, functions, symbols and bigint refused. |
| `messages.ts` | `encode`, `decode`, the builders (`request`, `notification`, `success`, `failure`) and the guards. |
| `source-files.ts` | The node to file rule: `nodeFile`, `flowFile`, `kebab`, `parseOverrides`, `SOURCE_ROOTS`, `SOURCE_OVERRIDES_PATH`. |
| `devices.ts` | The 21 device presets and their rules, shared by workspace and gameView: `DEVICES`, `DEVICE_GROUPS`, `DEFAULT_DEVICE`, `deviceById`, `presetOf`, `isDevicePresetId`, `screenOf`, `resolveDevice`. Types `DevicePresetId`, `Orientation`, `DeviceSize` are in `types.ts`. |
| `overlay-host.ts` | `HOST_ATTRIBUTE`: the marker overlay sets on its host; the bridge's tap watch skips events whose path holds it. |
| `reload.ts` | The two reload signals (U9, U10): `isReloading(status)`, true for the neutral `lost` of an expected reload (`reloading: true`); `isHotSwapEntry(entry)`, true for the game.log entry of an applied dev hot swap (game 0.5.0: event `ui:hot-swap`, numeric `ts`, `data.file`). A refused swap logs `ui:hot-refused` and the page reloads. The game.log value is the whole trace, so a caller tests its entries. |

Shapes added in round 2 (R4, R6):

| Type | Fields |
|---|---|
| `Manifest.restored?` | `{ bookmark: string, frame: number }`: the bridge's first hello after it restored its checkpoint across Bun's full reload. `bookmark` is the JSON text of the restored bookmark, `frame` the frame of the page that took it. |
| `HotReload` | `{ hmr: boolean, owner: "bin" \| "server" }`: the hub's editor-channel notification `hotReload`. |
| `DeviceSpec` | Gains `dpr`, `radius`, `group` (`iphone`, `android`, `foldable`, `tablet`, `desktop`), `frame` (`"modern"` \| `"home-button"`, round 2b R9: the bezel gameView draws), `approx?: true`, `fold?: { cover, inner }` of `FoldScreen { w, h, radius }`. `dpr`, `radius`, `group` and `frame` are required: `devices.ts` fills them for the 21 presets. |

Shapes of the selection relay (change selection-hmr-switch, A4, A5, A10, A15):

| Type | Fields |
|---|---|
| `SelectionInfo` | All readonly. `ref` (`SelectionRef`: `{ kind: "ui", path }` or `{ kind: "entity", id }`, the scene's `ElementRef`), `name`, `type`, `at` (`Date.now()` at publish) required. Optional: `key`, `projection`, `rect` (`SelectionRect` in page CSS px, as `SceneNode.rect`), `source { path, line }`, `card` and `crop` (project-relative, in a day folder `<capturesDir>/<yyyy-mm-dd>/`), `line` (the `@moku …` reference), `session`, `frame` (the scene frame; after a pick, the pick frame), `area` and `items` (an area selection, below). The readonly `items` make it not assignable to `Json`: senders pass it through `toWireValue`, like a `Manifest`. |
| `SelectionItem` | All readonly. One element of an area selection: `ref`, `name`, `type` required; `key`, `rect`, `source` optional. |
| Area selection (U9) | `type: "area"`, `name: "area"`, `rect` = `area` = the dragged area in page CSS px, `items` = the group roots inside, top to bottom then left to right, at most 40. `ref` = the first item's ref, or `{ kind: "ui", path: "" }` when no element is inside (`items: []`). |
| `PublishParams` | `{ hotReload: HotReload, selection: SelectionInfo \| null }`. `PublishMethod` is its keys: `"hotReload" \| "selection"`. |
| `PictureFormat` | `"jpeg" \| "png"`: the format of a picture on the wire (editor.capture, editor.sheet, a crop). JPEG is the default (D-34). capture, gameView and the MCP bridge use this one type. |
| `SelectParams` | `{ key?: string, ref?: SelectionRef, rect?: SelectionRect, card?: boolean }`. `rect` picks an area like a Reference-mode drag and wins over `key` and `ref`. The page treats an absent `card` as `true`. |
| `EditorNotifications`, `EditorRequests` | The editor channel by method, below. `EditorNotificationMethod` and `EditorRequestMethod` are their keys. |

```ts
parseSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1, zoom: 2 });
// { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
parseSelectParams({ rect: { x: 0, y: 30, w: 200, h: 60 } }); // an area: every element inside
parseSelectParams({ card: "yes" }); // undefined
```

Editor-channel methods:

| Kind | Method | Params | Result | Between |
|---|---|---|---|---|
| notification | `session` | `SessionParams` | | hub to agents and tools |
| notification | `sessions` | `SessionsParams` | | hub to tools |
| notification | `hotReload` | `HotReload` | | hub to tools (published) |
| notification | `selection` | `SelectionInfo \| null` | | editor page to hub, hub to tools (published) |
| request | `selection` | `{}` | `SelectionInfo \| null` | tools to hub |
| request | `select` | `SelectParams` | `SelectionInfo` | tools to hub, hub to the editor page |

A null selection travels as a `selection` notification without params.

Errors of the selection relay:

| Reason | Code | `errorCode` | Retryable | When |
|---|---|---|---|---|
| `no_editor_page` | -32003 | `noEditorPage` | no | No tools connection with `role=page` is open. |
| `page_closed` | -32001 | `pageClosed` | yes | The page closed before it answered. |

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
