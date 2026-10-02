# registry

> Complex plugin (agent core). The only place where the editor touches the game's doors.

It wraps every source and command of `@moku-labs/game/inspect` and `@moku-labs/game/control`,
the game's `.dev` modules and the editor's own commands (`editor.*`) into closure-erased
entries: raw `Json` in, checked input to the door, wire-safe `Json` out. It builds the
`Manifest` the bridge sends in `hello`. It also owns the runtime-free protocol module
`./protocol`, which hub, files, pages, link, workspace, panels and the views import.

## API

| Method | Returns | Notes |
|---|---|---|
| `manifest()` | `Manifest` | Frozen. Descriptors only, cached until the next `add`. `game`, `page`, `embedded` are read at call time. |
| `source(id)` | `SourceEntry \| undefined` | `read(raw)` and `watch(raw, fn)`. A watch never throws into the frame loop. |
| `command(id)` | `CommandEntry \| undefined` | `run(raw)` is async and never throws synchronously. |
| `add(entry)` | `void` | Adds an editor command. Call it in `onInit`. Refuses a bad or used id, an unknown kind, and `cheat` or `raw`. |
| `envelope()` | `RunState` | `{ path, frame, tainted }` for editor commands that run no door. |
| `clock()` | `Clock` | `{ frame, paused }` from the game clock. Read by the channel heartbeat. |

Errors of the entries:

| Case | Code | Message |
|---|---|---|
| Bad input | -32602 `invalid_input` | `[moku-editor] game.step: frames must be a number` |
| The door threw | -32000 `command_failed` | `[moku-editor] <id>: <first line of the door message>` |
| The value is not JSON | -32006 `not_json` | `[moku-editor] <id>: function is not JSON at $.a[0]` |

Logs: `registry:source-failed`, `registry:command-failed`, `registry:watch-failed` (once per streak).

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `game` | `undefined` | Required. The app the game made with `createApp`. `createApp` throws without it. |
| `modules` | `[]` | The game's `.dev` modules: extra sources and commands, added after the doors. |
| `name` | `undefined` | `Manifest.game`. Falls back to `document.title`, then `"game"`. |

```ts
createApp({ pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } } });
```

Order in the manifest: door entries, then modules in config order, then editor commands in `add` order.

## Events

None. The registry emits and hooks no events.

## Protocol (`./protocol`)

Runtime-free, re-exported from `"."`. It imports nothing outside itself.

| Module | Holds |
|---|---|
| `types.ts` | Every wire type and the shared wire shapes (`SessionInfo`, `FileEntry`, `ToolsBoot`, …). |
| `errors.ts` | `errorCode`, `ProtocolError`, `wireError`, `isWireError`, `toWireError`, `fromWireError`, `isRetryable`, `bareMessage`. |
| `check.ts` | `checkInput`, `isJson`. Holds the one boundary cast of the editor. |
| `wire-value.ts` | `toWireValue`: `$map`, `$set`, `$error` tags; cycles, depth over 64, functions, symbols and bigint refused. |
| `messages.ts` | `encode`, `decode`, the builders and the guards. |
| `source-files.ts` | The node to file rule: overrides, then no file for sub-flow and slot nodes, then `nodes/<kebab>.ts(x)` and `flows/<flow>.ts`. |
