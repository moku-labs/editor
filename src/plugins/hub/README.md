# hub

> Complex plugin, server core. The editor's websocket switchboard inside a Bun server.

Checks Host, Origin and a per-start token before any upgrade. Runs the one websocket handler
Bun allows per server, with two connection kinds: `agent` (a game page) and `tools` (a tools
page). A tools connection with `role=page` is the editor page. Keeps the game sessions. Routes
game-channel requests from tools to the chosen session and files-channel requests to `files`.
Keeps the editor page's selection and relays `editor.select`, `editor.device`, `editor.show` and
`editor.node` to the page. Publishes the project
index state of `files` as `editor.project` and answers `files.find`. Publishes the computer's
engine fingerprint (`files.engine()`) as `editor.engine`. Wraps the game's `Bun.serve` options
with `serve`.

Device mode (off until `listenDevices()` runs, the `moku-editor perf` command): the hub starts its
own listeners on `127.0.0.1:<devicePort>` (a phone reaches it through `adb reverse`) and, with
`deviceLan`, on the computer's LAN address. A game page in a native WebView connects there as
`kind=agent role=device`, pairs with a 4-digit code, and then runs as an ordinary agent session
that every tools page sees, plus `perf.lines`: batches of the device's performance log, handed on
as the per-plugin event `hub:device`. While device mode runs, `listenLan()` / `stopLan()` turn the
LAN listener on and off without dropping the phones by wire, and every paired phone is pinged once
a second for its link latency. Other server plugins (`connect`) register editor-channel methods
with `addEditorMethods`; only tools connections reach them. A `run` a tools connection sends is
stamped with `from` (`"page"` or `"mcp"`) and, for an agent, the MCP client's name, when the
target agent's `hello` named the `run-from` capability. See
[Device mode](#device-mode), [Editor methods of other plugins](#editor-methods-of-other-plugins)
and [Run stamping](#run-stamping).

## Configuration

Set through `pluginConfigs.hub`. Checked in `onInit`; a bad value makes `createApp` throw a
`[moku-editor] hub.<field> …` error (a `TypeError` for the six device-mode fields, in the
two-line form `[moku-editor] hub.<field> is <value>.` and the rule with an example).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `path` | `string` | `"/__editor"` | URL prefix of every editor route. Starts with `/`. Letters, digits, `_`, `-`, `/`. No trailing or double slash. |
| `allowOrigins` | `readonly string[]` | `[]` | Extra exact http(s) origins allowed to upgrade and to call same-origin routes, for example `"http://192.168.1.4:3000"`. No path, no trailing slash. |
| `callTimeoutMs` | `number` | `5000` | Deadline of a forwarded call before it fails with -32002. Integer ≥ 100. |
| `silentAfterMs` | `number` | `6000` | A session with no heartbeat for this long is marked silent. Integer ≥ 100. After a `paused: true` heartbeat the limit is 65 s (`PAUSED_SILENT_AFTER_MS`). |
| `devicePort` | `number` | `47600` | Port of the device listeners (127.0.0.1 and, with `deviceLan`, the LAN address). Integer 0–65535; 0 picks a free port (tests). |
| `deviceLan` | `boolean` | `false` | Also listen on the computer's LAN address: device upgrades only, pairing confirmed by the person. |
| `lanAddress` | `string \| undefined` | `undefined` | The LAN address to bind: an IPv4 literal, or an IPv6 literal in canonical lower case without a zone id (`"fe80::1"`, not `"FE80::1"` or `"fe80::1%en0"`; the LAN Host check compares the exact text). Unset picks the first non-internal IPv4 of an `en*`, `wl*` or `eth*` interface, else of any interface. |
| `deviceOrigins` | `readonly string[]` | `["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"]` | Exact Origins a device's WebView sends: scheme `tauri:`, `http:` or `https:`, a host, no path, no trailing slash, lower case. Never added to the normal listener's origins. |
| `pairing` | `"lan" \| "always"` | `"lan"` | `"lan"`: only LAN phones are asked; an adb phone is confirmed at once. `"always"`: every phone is asked. |
| `pairTimeoutMs` | `number` | `60000` | How long a pairing waits for the person before it is refused. Integer ≥ 1000. |

```ts
createApp({ pluginConfigs: { hub: { devicePort: 47600, deviceLan: true } } });
```

Breaking (pre-1.0, D-30): `allow` is renamed `allowOrigins`. `files.allow` keeps its name: it
lists globs, not origins.

```ts
// now
createApp({ pluginConfigs: { hub: { allowOrigins: ["http://192.168.1.4:3000"] } } });
// before
createApp({ pluginConfigs: { hub: { allow: ["http://192.168.1.4:3000"] } } });
```

## API

`app.hub` or `ctx.require(hubPlugin)`. Type `HubApi`.

| Member | Signature | What it does |
|---|---|---|
| `serve` | `(options: ServeOptions) => BunServeOptions` | Wraps the game's `Bun.serve` options. Forces `127.0.0.1`. Adds the editor routes, `{path}/ws` and the websocket handler. |
| `token` | `() => string` | The token of this start: 32 random bytes, base64url, 43 characters. Never logged. |
| `sessions` | `() => SessionInfo[]` | A fresh list ordered by `connectedAt`. A device session carries `device`. |
| `fetch` | `(req: Request, server: HubServer) => Response \| undefined` | The `{path}/ws` upgrade handler. `undefined` after an upgrade, else a refusal. |
| `websocket` | `HubWebSocketHandler` | The one websocket handler. 32 MiB frames, 60 s idle, no deflate. |
| `addRoutes` | `(routes: EditorRoutes) => void` | Registers editor routes under the path. `serve` and the adb listener of `listenDevices` merge them; both freeze them. |
| `guard` | `(req: Request, server: HubServer, mode: GuardMode) => Response \| undefined` | The shared Host / Origin / Sec-Fetch-Site check. `undefined` means allowed, else a 403. |
| `publish` | `<M extends PublishMethod>(method: M, params: PublishParams[M]) => void` | Sends server state to every tools page as `editor.<method>` and keeps the last value per method. `hotReload` takes a `HotReload`, `selection` a `SelectionInfo` or `null`, `project` a `ProjectState`, `engine` an `EngineInfo`, `devices` connect's `DeviceDirectory`, `deviceTelemetry` connect's `DeviceTelemetry`. A tools page that connects later gets it right after `sessions {list}`. The held `deviceTelemetry` is dropped when device mode stops. |
| `closeAll` | `(code: number, reason: string) => Promise<void>` | Closes every agent, tools and device socket with one code and reason, and resolves when Bun reported the closes (at most 500 ms). The hub keeps running and keeps its token; a phone reconnects with its device token. |
| `path` | `() => string` | `config.path`. |
| `listenDevices` | `(options: DeviceListenOptions) => Promise<DeviceListen>` | Turns device mode on: the adb listener and, with `deviceLan`, the LAN listener. Emits `hub:device { kind: "listening" }`. |
| `stopDevices` | `() => Promise<void>` | Turns device mode off: `closed` per connected device, then `stopped`. Does nothing while off. |
| `devices` | `() => LinkedDevice[]` | The paired devices of this device-mode run, by `pairedAt`, frozen copies without tokens, each with its `latencyMs`. `[]` while off. |
| `listenLan` | `() => Promise<DeviceListen>` | Adds the LAN listener while device mode runs; the phones by wire stay. Idempotent. Emits `hub:device { kind: "listening" }`. |
| `stopLan` | `() => Promise<void>` | Removes the LAN listener: LAN phones close 1001 `lan off`, phones by wire stay. Emits `listening` with `lan: null`. Does nothing without one. |
| `addEditorMethods` | `(methods: Readonly<Record<string, EditorMethod>>) => void` | Registers `<plugin>.<verb>` editor-channel methods of another server plugin, reachable from tools connections only. Before the server starts. |

The hub has no `engine()` member: the fingerprint is `files.engine()`; the hub publishes it as
`editor.engine`.

### `serve(options)`

```ts
Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
```

Merged routes: the game's `routes`, then the routes from `addRoutes`, then `{path}/ws`. The
socket is a route, so a game wildcard like `"/*"` cannot shadow it. Without a game `fetch`, the
fallback answers 404. Unknown option keys pass through to Bun.

`serve` throws, with the `[moku-editor]` prefix:

| Case | Example |
|---|---|
| App not started | `serve` before `await editor.start()` |
| Second call | one server per app |
| A `websocket` option | the editor owns the one handler |
| `unix` or `tls` | Host and Origin checks need `http://127.0.0.1:<port>` |
| Hostname other than `127.0.0.1` / `localhost` | `"0.0.0.0"`, `"::"`, `""`, `"192.168.1.4"` |
| A game route under the editor path | `"/__editor"`, `"/__editor/x"` |

### `token()`

```ts
const token = editor.hub.token();
```

Throws before start and after stop. A new token on every start.

### `sessions()`

```ts
editor.hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", page: "http://127.0.0.1:3000/", embedded: true, connectedAt: 1790000000000, manifestHash: "4f528e73", heartbeat: { frame: 1840, paused: false, silent: false } }]
// A paired phone's session adds: device: { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z" }
```

`SessionInfo` has `id`, `game`, `page`, `embedded`, `connectedAt` and `manifestHash`.
`manifestHash` is `commandsHash(manifest)` from `registry/protocol` (D-37): 8 hex chars over the
command doors only (id, effect, input; not titles, not sources). The hub computes it once on
`hello` and sends it in every `sessions {list}`, so the MCP bridge rebuilds its door tools only
when it moves. After the first heartbeat it also has `heartbeat {frame, paused, silent}`: frame
and paused of the last beat and the hub's silent flag. `at`, `heap` and `lastBeatAt` stay private.
A device session (a paired phone) has `device`: `SessionDevice` with the device listener's real
port, and `appId` when the phone's pair named its app (`"com.mokulabs.timber.debug"`; an engine
before the app id, 0.15.0, names none). Mutating the result does not change the next call.

### `fetch(req, server)`

```ts
fetch: (req, server) => editor.hub.fetch(req, server) ?? new Response("upgraded")
```

`serve` already mounts it as `{path}/ws`. Upgrade URL: `{path}/ws?token=<t>&kind=agent|tools`,
plus `&role=page` for the editor page (link in the tools page). A tools connection without
`role` is a plain tools client, for example the MCP bridge.
Checks run in this order. Each refusal is `text/plain`, `cache-control: no-store`, a one-word
body, and one `hub:refused` warn log with `status`, `check`, `host`, `origin` (never the URL,
never the token).

| # | Check | Status | Body |
|---|---|---|---|
| 1 | pathname is exactly `{path}/ws` | 404 | `missing` |
| 2 | app started (token set) | 503 | `unavailable` |
| 3 | `GET` and `Upgrade: websocket` | 426 | `upgrade` |
| 4 | `guard(…, "upgrade")`: port, Host, then Origin (required) | 403 | `forbidden` |
| 5 | query `token` equals the token (timing-safe) | 401 | `unauthorized` |
| 6 | query `kind` is `agent` or `tools` | 400 | `invalid` |
| 7 | query `role` is absent, or `page` with `kind=tools` | 400 | `invalid` |
| 8 | `server.upgrade` returns true | 400 | `invalid` |

An accepted upgrade keeps the server port. The `no_editor_page` error names the editor page URL
`http://127.0.0.1:<port>{path}/` with it.

### `websocket`

`open` registers the connection. A tools connection, the editor page too, gets `sessions {list}`
at once, then every published value. A socket
that opens after stop is closed with 1001. `message` closes on a binary frame (1003) and decodes
text. `close` ends the agent's session or the tools subscriptions. `drain` flushes the tools
backlog.

### `addRoutes(routes)`

```ts
editor.hub.addRoutes({ "/__editor/hello": helloRoute });
```

Call it in `onInit`. Keys are checked first, so a refused batch registers nothing. Throws after
`serve` or `listenDevices` (both serve the routes and freeze them), on a key registered before, on `{path}/ws`, and on a key that is neither `path` nor
under `path + "/"`.

### `guard(req, server, mode)`

```ts
const refused = editor.hub.guard(req, server, "same-origin");
if (refused) return refused;
```

| Mode | Host | Origin | Sec-Fetch-Site |
|---|---|---|---|
| `upgrade` | allowed | required, allowed | ignored |
| `same-origin` | allowed | allowed when present | `same-origin` or `none` when present |
| `navigate` | allowed | allowed when present | ignored |

Allowed hosts: `127.0.0.1:<port>` and `localhost:<port>`, plus the bare names on port 80.
Compared lowercased and exact. Allowed origins: `http://` plus each allowed host, plus
`config.allowOrigins`. The origin `null` never matches. A server without a port is refused.

### `publish(method, params)`

```ts
editor.hub.publish("hotReload", { hmr: true, owner: "bin" });
// every tools socket: {"jsonrpc":"2.0","channel":"editor","method":"hotReload","params":{"hmr":true,"owner":"bin"}}
editor.hub.publish("selection", null);
// every tools socket: {"jsonrpc":"2.0","channel":"editor","method":"selection"}
```

| Method | Params | Published by |
|---|---|---|
| `hotReload` | `HotReload` `{ hmr, owner }` | pages, from `attachServer` and after `setHotReload` (R6) |
| `selection` | `SelectionInfo \| null` | the hub, from the editor page's `selection` notification; `null` when the last page closes |
| `project` | `ProjectState` | the hub, from the files event `files:project`: the project index on (revision, key maps, broken files, last change) or off with its reason |
| `engine` | `EngineInfo` `{ id, version, dist, patch? }` | the hub, from `files.engine()` on start, and again after a phone pairs or reconnects when `files.refreshEngine()` answers another id |
| `devices` | `DeviceDirectory` (`connect/protocol`) | connect: the phones by wire, asking to link and linked |
| `deviceTelemetry` | `DeviceTelemetry` (`connect/protocol`) | connect: the wired telemetry of a watched phone, ~1 Hz. Dropped from `state.published` when device mode stops, so it is never replayed from an older run. |

The value is stored through `toWireValue` in `state.published`, also before start. A
`SelectionInfo` with readonly `items` is not `Json`; the conversion makes it plain. `null` goes
out as a notification without `params`: the wire refuses `"params": null`. It is a state
notification: sent while a tools connection is congested too, never dropped.

### `closeAll(code, reason)`

```ts
await editor.hub.closeAll(1012, "editor restarting");
// every agent and tools socket closed with 1012 "editor restarting", or 500 ms passed
```

The bin awaits it before Bun's stop when the Hot reload switch restarts its server
(pages `serve.ts`). It resolves when Bun reported every close, at most after 500 ms. A stop before
that drops the close frame, and the client sees 1006. Clients see a clean 1012 instead. The bridge and
link log it at info and reconnect as after any close. The hub keeps running: the token stays,
and each connection is forgotten when Bun reports its close, so its session or subscriptions end
as on any close. Logged at info as `hub:close-all` with the socket count.

### `path()`

```ts
editor.hub.path(); // "/__editor"
```

### Wire rules

Hub notifications use channel `editor`. Forwarded agent traffic keeps channel `game` and
carries `session`.

Agent connection:

| Incoming | Result |
|---|---|
| Anything before `hello` | close 1008 `hello first` |
| `hello {manifest, caps?}`, manifest valid (`restored` absent or `{ bookmark: string, frame: number }`) | session opens with the known capabilities of `caps` (`capsOf`: `["run-from"]` from a current bridge, `[]` from an older one; unknown names are ignored), id `s-` + 4 hex. The agent gets `session {id, game, open: true, engine}` (`engine`: the computer's engine id, once published). Tools get `session {id, game, open}` and `sessions {list}`. `hub:session` is emitted. |
| `hello` with a bad manifest | close 1008 `bad manifest` |
| `hello` a second time | close 1008 `hello twice` |
| `heartbeat {frame, paused, at, heap?}` | stored, a silent session comes back, forwarded to every tools connection. When `paused` flips against the last beat, or a silent session comes back, tools first get `sessions {list}` again. `heap {usedMb, limitMb}` is kept when both are finite numbers. A malformed `heap` is dropped and the beat still goes through. |
| `value {sub, value}` | fanned out to the tools subscribers |
| `tap {x, y, at}` | forwarded to every tools connection with `session`, like a heartbeat. Only `x`, `y` and `at` are kept. |
| `bye` | the close reason becomes `bye` |
| `perf.lines` on channel `editor` | a paired phone only, before or after `hello` (see [Device mode](#device-mode)); from any other agent it is ignored with `hub:unknown-notification` |
| Response to a forwarded call | settled to its target. An unknown id is a `hub:late-response` debug log. |
| Any request | error -32007 `unauthorized`, nothing dispatched |
| Malformed heartbeat, value or tap, undecodable text | one strike. Ten strikes close with 1008. |

Tools connection requests:

| Channel | Method | Params | Result |
|---|---|---|---|
| `game` | `manifest` | `{}` | `Manifest` of the chosen session |
| `game` | `read` | `{ id, input? }` | forwarded, `Json` |
| `game` | `run` | `{ id, input? }` (a `from` or `client` of the tools client is taken and dropped) | forwarded as `{ id, input? }`, with the hub's `from` and `client` for an agent that named `run-from` ([Run stamping](#run-stamping)), `RunResult` |
| `game` | `watch` | `{ sub, id, input? }` | `null`, then `value {sub, value}` notifications |
| `game` | `unwatch` | `{ sub }` | `null` (an unknown sub is fine) |
| `files` | `list` | `{ dir }` | `FileEntry[]` |
| `files` | `read` | `{ path }` | `FileText` |
| `files` | `write` | `{ path, text, version? }` | `WriteResult` |
| `files` | `writeBinary` | `{ path, data }` (a data URL) | `WriteResult` |
| `files` | `readBinary` | `{ path }` | `FileBinary` |
| `files` | `find` | `{ key }` (a project-index key, e.g. `node:board/merge`) | `ProjectFound[]`, lines read from disk now. -32008 `not_installed` while the index is off. |
| `editor` | `selection` | `{}` | the kept `SelectionInfo`, or `null`. Answered by the hub. |
| `editor` | `select` | `SelectParams` `{ key?, ref?, rect?, card? }` | `SelectionInfo`, relayed to the editor page |
| `editor` | `device` | `DeviceParams` `{ preset?, orientation?, folded? }`. `{}` reads the device. | `DeviceInfo`, relayed to the editor page |
| `editor` | `show` | `ShowParams` `{ workspace? }`. `{}` reads the active workspace. | `ShowInfo`, relayed to the editor page |
| `editor` | `node` | `NodeParams` `{ id }`, 1 to 256 chars | `NodeInfo`, relayed to the editor page |
| `editor` | a registered `<plugin>.<verb>` | the method's own | the method's answer ([Editor methods of other plugins](#editor-methods-of-other-plugins)) |
| other | any | | -32601 |

Before a game call is forwarded, the hub checks the session choice, the id in the manifest and
the input. `select` params are checked with `parseSelectParams`; unknown fields are dropped.
`device`, `show` and `node` params are checked with `parseDeviceParams`, `parseShowParams` and
`parseNodeParams`. These are closed objects: an unknown field is -32602. Absent params are
checked as `{}`. One table in `sockets/tools.ts` maps each relayed method to its parser.

Editor page relay of `select`, `device`, `show` and `node` (D-33, D-60, A3, A6, A7):

| Step | Rule |
|---|---|
| Choice | The page that published the kept selection, while it is open. Else the newest page connection. |
| Request | `{"channel":"editor","method":"<method>","id":<hub id>,"params":…}` to the page, with the checked copy of the params. |
| Answer | The page's response settles only a call relayed to that page. It goes back to the caller with the caller's id. An agent or another page cannot settle it. |
| Deadline | `callTimeoutMs`. A `select` with `card: true` or no `card`: `4 × callTimeoutMs`. The extension is capped at 60 s, like every long call. |
| No page | -32003 `no_editor_page`: `no editor page is open. Open the editor page: http://127.0.0.1:<port>{path}/` |
| Page closes | Its relayed calls fail -32001 `page_closed`, retryable. |
| Session ends | Relayed calls keep waiting: `failSession` fails agent calls only. |

Tools connection notifications and responses:

| From | Incoming | Result |
|---|---|---|
| editor page | `selection` with a `SelectionInfo` | checked with `parseSelectionInfo`, unknown fields dropped, published. The page becomes the one relayed requests go to. |
| editor page | `selection` without params | nothing is selected: `null` is published. |
| editor page | `selection` with a bad value | one strike, nothing published |
| editor page | response | settles a call relayed to this page; else `hub:late-response` |
| editor page | `client` | ignored, `hub:tools-ignored` (its runs are always `from: "page"`) |
| plain tools | `client { name }` | the MCP client's name, cleaned by `clientNameOf`; last value wins, an empty name clears it. Logged `hub:tools-client` at debug. |
| plain tools | `selection`, any response | ignored, `hub:tools-ignored` |
| any | other notification | ignored, `hub:tools-ignored` |

When the last editor page closes, the hub publishes `selection: null`. On `onStop` a kept
selection becomes `null` too.

What a tools connection gets on channel `editor`: `sessions {list}` at open, then every published
value (`engine`, `hotReload {hmr, owner}`, `selection`, `project`); `session {…}` and `sessions {list}` on each session
change; `sessions {list}` again when a session's `paused` or `silent` flips (not on every frame);
`hotReload`, `selection` and `project` again on each publish.

Errors the hub builds (message prefix `[moku-editor]`):

| Code | Reason | Retryable | When |
|---|---|---|---|
| -32001 | `game_reloaded` | yes | the agent closed while the call was pending |
| -32001 | `page_closed` | yes | the editor page closed before it answered a relayed request |
| -32002 | `timeout` | yes | the call passed its deadline |
| -32003 | `no_session` | no | the named session is not open (`data.id`), or no game is connected |
| -32003 | `choose_session` | no | several sessions and not exactly one `embedded` |
| -32003 | `no_editor_page` | no | `editor.select`, `device`, `show` or `node` and no tools connection with `role=page` is open |
| -32601 | `unknown_id` | no | the source or command id is not in the manifest (`data.id`) |
| -32601 | | no | unknown channel or method |
| -32602 | `invalid_input` | no | bad params or input; `sub` not a safe integer ≥ 0; `select`, `device`, `show` or `node` params that do not fit `SelectParams`, `DeviceParams`, `ShowParams` or `NodeParams` |
| -32600 | | no | duplicate `sub` on one connection; more than 256 pending calls |
| -32007 | `unauthorized` | no | a request from an agent (a registered editor method included) |

Files errors keep their own code and data. Any other throw becomes -32000 with the message
only, never a stack.

Session choice when a game request has no `session`: one open session wins; with several, the
only `embedded` one wins; otherwise -32003.

Deadline of a forwarded call: `callTimeoutMs`. A `run` of `editor.series` waits its
`input.durationMs` on top, and a `run` of `editor.sheet` its `input.frames × input.everyMs`, up to
60 s more. The same rule runs in bridge and link. A relayed `select` with a card waits
`3 × callTimeoutMs` on top, under the same 60 s cap.

### Run stamping

A `run` a tools connection sends reaches the agent with the hub's own origin (spec 11 § 5.1,
delta-data cross-unit row "hub") when the agent can read it: its `hello` names the capability
`run-from` (`RUN_FROM_CAP`, `hub/protocol`; the hub keeps the known `caps` on the session). The
game's bridge turns `from` into the registry's `via` and passes `client` to the command (spec 07
B1), so the recorder can say "started by agent (Claude Code)".

| Target agent | Sender | Forwarded params |
|---|---|---|
| hello names `run-from` | editor page (`role=page`) | `{ id, input?, from: "page" }` |
| hello names `run-from` | plain tools (the MCP bridge) before a `client` notification | `{ id, input?, from: "mcp" }` |
| hello names `run-from` | plain tools after `client { name: "Claude Code" }` | `{ id, input?, from: "mcp", client: "Claude Code" }` |
| no `run-from` (an older bridge, an installed debug build) | anyone | `{ id, input? }`, as before: an agent that checks its run params strictly would refuse `from` with -32602 |

A `from` or `client` the tools client wrote into the run params is never forwarded: only the
checked `id` and `input` are read (`runParamsOf`). A `read` is forwarded as sent. `clientNameOf`
(`hub/protocol`) drops control and bidi characters, trims, and cuts at 64 characters; an empty
result is no name.

### Editor methods of other plugins

`addEditorMethods(methods)` registers editor-channel request handlers another server plugin owns,
in its `onInit` (spec 11 § 5.1 H2):

```ts
// connect registers its methods in onInit, before the server starts.
ctx.require(hubPlugin).addEditorMethods({ "connect.scan": async () => ({ wire: [] }) });
// a tools page's request editor.connect.scan is answered { wire: [] }
```

| Rule | What |
|---|---|
| Who reaches it | tools connections only (hub token, loopback Host and Origin). An agent's or a paired phone's request is -32007 before routing; the LAN listener has no tools socket. |
| Order | `selection` → the relayed `select`, `device`, `show`, `node` → a registered method → -32601 |
| Handler | `EditorMethod` `(params: Json \| undefined, caller: { conn }) => Promise<Json>`; counts as a pending call (256 per connection) |
| Errors | a throw or a rejection is answered through `toWireError`; the socket stays open |
| Closed caller | the answer is dropped |
| Registration | names are checked first, so a refused batch registers nothing. Two-line `Error` after `serve()` / `listenDevices()` (`hub.addEditorMethods() ran after hub.serve() or hub.listenDevices().`), for a name registered before, a name of the hub (`selection`, `select`, `device`, `show`, `node`) and a name that is not `<plugin>.<verb>`; a `TypeError` for a handler that is not a function. |

### Fan-out and backpressure

Fan-out: one agent-side watch per `(session, source, input)`. The key sorts object keys, so
`{a, b}` and `{b, a}` share a watch. A late subscriber gets `null` and then the last value. The
last unwatch sends one `unwatch` to the agent.

Backpressure: when `send` returns -1 a tools connection is congested. Values coalesce to the
latest per `sub`, heartbeats and taps are dropped, responses, session and published
notifications are still sent.
`drain` flushes the backlog in order.

## Device mode

`listenDevices(options)` turns it on after `await editor.start()`; the `moku-editor perf` command
calls it. `stopDevices()` turns it off; `onStop` tears it down too.

```ts
// moku-editor perf --lan, after await editor.start().
const listen = await editor.hub.listenDevices({ confirm: askInTerminal });
// { port: 47600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" }

// The perf command's Ctrl+C turns phones off before it stops the editor.
await editor.hub.stopDevices();
editor.hub.devices(); // []
```

| Option | Type | Meaning |
|---|---|---|
| `confirm` | `PairConfirm` `(request: PairRequest, signal: AbortSignal) => Promise<boolean>` | Asks the person whether a phone may link. A missing or non-function value is a `TypeError`. |
| `routes` | `Readonly<Record<string, unknown>>`, optional | Non-editor routes of the adb listener, e.g. `"/"` for a page that says no game is served here. A key under the editor path is refused. |

`DeviceListen` `{ port, adb, lan }`: the real port (the random one under `devicePort: 0`), the
adb listener `127.0.0.1:<port>`, the LAN listener `<address>:<port>` (IPv6 in brackets) or
`null`. The listeners:

| Listener | Binds | Serves |
|---|---|---|
| adb | `127.0.0.1:<devicePort>` | the `routes` option, every editor route of `addRoutes` (the tools page), `{path}/ws`; anything else 404 |
| LAN (`deviceLan`) | `<lan address>:<same port>` | `{path}/ws` only; anything else 404 |

Both share the hub's one websocket handler. `listenDevices` freezes the editor routes, logs
`hub:devices-on { port, lan }` and emits `hub:device { kind: "listening", listen }`. Errors (all
two-line `[moku-editor] …`):

| Case | Error |
|---|---|
| Before start | `Error`: `hub.listenDevices() needs a started app.` / `Call it after await editor.start().` |
| Device mode already on | `Error`: `hub.listenDevices(): device mode is already on.` / `Call hub.stopDevices() first.` |
| `deviceLan` and no LAN address | `Error`: `hub: --lan found no LAN address on this computer.` / `Connect to a Wi-Fi or set pluginConfigs.hub.lanAddress.` |
| Port in use | `Error` with `code: "EADDRINUSE"`: `port 47600 is in use.` / `Is another moku-editor perf running? Try --port 47601.` A failing LAN listener stops the adb one first. |
| `confirm` not a function | `TypeError` |

`stopDevices()` emits `hub:device { kind: "closed", device, reason: "stopped" }` for each paired
device with a connection, then the state-only `teardownDevices(state)` runs: the device ping
stops, pending pairings are aborted, the device records (and their tokens) are forgotten, device
connections close with 1001 `device mode off`, the held `deviceTelemetry` publish is dropped (a
tools page never gets one of an older run), both listeners stop (at most 500 ms). Then `hub:devices-off` is logged and
`hub:device { kind: "stopped" }` emitted. A call while device mode is off does nothing. `onStop`
runs `teardownDevices` only: no emit, no log line (the teardown context has neither).

`devices()` answers `LinkedDevice[]`: `SessionDevice` (with `appId` when the pair named one) plus
`pairedAt`, `online` and `latencyMs`.

```ts
// After a Galaxy A26 paired over adb reverse.
editor.hub.devices(); // [{ id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z", pairedAt: 1791986083963, online: true, latencyMs: 9 }]
```

### The LAN listener on and off

`listenLan()` adds the LAN listener while device mode runs (`connect`'s "On the network"):

| Case | Result |
|---|---|
| Device mode off | `Error`: `hub.listenLan() needs device mode.` / `Call hub.listenDevices() first.` |
| LAN listener on (also from `deviceLan`) | nothing starts; the current `DeviceListen` |
| Otherwise | the address as for `deviceLan` (`lanAddress`, else the picked card; none: the no-LAN `Error`), the LAN listener on the adb listener's real port with `{path}/ws` only, `lan` set, `hub:devices-lan { lan }` logged, `hub:device { kind: "listening", listen }` emitted. A port in use is the port `Error`; device mode stays as it was. |

`stopLan()` closes every LAN device connection 1001 `lan off` (a paired one is announced `closed`
with reason `stopped`, `online: false`, and stays paired: it may come back with its token; a
pairing one loses its question), sets `lan: null`, logs `hub:devices-lan { lan: null }`, emits
`listening` and stops the LAN listener (at most 500 ms). Phones by wire keep their sessions.
Without a LAN listener it does nothing. `teardownDevices` stops a LAN listener `listenLan` started.

### Link latency

While device mode runs, each paired device connection is pinged once a second (`ws.ping()` with
the send time as the payload). The pong that echoes the payload of the connection's last ping sets
the record's `latencyMs` (the last value; `null` before the first pong), reported in
`LinkedDevice.latencyMs`. A ping no pong answered is replaced by the next one; Bun's own keep-alive
pongs carry another payload and are ignored. A WebView answers pings at the protocol level, so the
phone needs nothing. The interval is unref'd and cleared by `teardownDevices`.

### The device upgrade

On both device listeners `{path}/ws` checks, in order (each refusal logged once as `hub:refused`,
never the URL or a token):

| # | Check | adb listener | LAN listener | Refusal |
|---|---|---|---|---|
| 1 | pathname is exactly `{path}/ws` | yes | yes | 404 `missing` |
| 2 | started and device mode on | yes | yes | 503 `unavailable` |
| 3 | `GET` + `Upgrade: websocket` | yes | yes | 426 `upgrade` |
| 4 | `kind=tools` | the normal upgrade's checks (guard on this port, hub token, kind, role) | refused | 403 `forbidden`, check `listener` |
| 5 | `kind=agent role=device` | required | required | 400 `invalid`, check `role` (`kind` for an unknown kind) |
| 6 | Host | a loopback Host of the port | exactly `<lan address>:<port>` | 403, check `host` |
| 7 | Origin | required, in `deviceOrigins`; `null` never matches | same | 403, check `origin` |
| 8 | credentials | `device` and `token` of this run: paired socket; a stale pair: accepted as unpaired; none: pairing socket | same | 400 (only one of the two); 429 `busy`, check `cooldown`, while the address cools down or already holds 4 open pairing sockets (`MAX_PAIRING_SOCKETS`) |
| 9 | `server.upgrade` | | | 400 `invalid` |

A stale device token (an earlier device-mode run, a forgotten device, a wrong token) is upgraded
and closed at open, before any message, with **4401 `unpaired`** (`DEVICE_UNPAIRED_CODE`,
`DEVICE_UNPAIRED_REASON` from `hub/protocol`): a browser cannot read the status of a refused
upgrade, so a 401 would look like "no computer". No session, no event, no strike; logged
`hub:device-unpaired { address, link }`. The bridge pairs again at once. The normal listener is
unchanged: `role=device` there is 400 and a device Origin 403.

### Pairing

A pairing socket's first message must be `editor`/`pair`
`{ code, device: { model?, os?, engine?, build?, appId? } }`; anything else closes it 1008 `pair first`.
A pairing socket that has no valid `pair` within 5 s (`PAIR_FIRST_MS`) closes 1008 `pair first`
too; a valid `pair` clears that deadline (then `pairTimeoutMs` governs the wait for the person). The
code is exactly four digits (`"0421"` keeps its zero): the phone shows it, the person types it in
the terminal. A code of another length or a second `pair` while one waits is a strike.

The device fields are sanitized in `hub/protocol` (`parsePairParams`), so the terminal's
question, the log lines and `SessionInfo.device` get clean text: a `model`, `os`, `engine`,
`build` or `appId` over 128 characters, or with a control character (C0, DEL, C1) or a bidi embedding,
override or isolate (U+202A–U+202E, U+2066–U+2069), makes the `pair` malformed: a strike, nobody
is asked. `normalizeModel` drops those characters from a model it is given (adb's output too).

| Step | Rule |
|---|---|
| Too many | 16 paired devices, or 4 pairings waiting: close 1008 `pairing busy` |
| adb under `pairing: "lan"` | confirmed at once, no question |
| Otherwise | queued; `confirm(request, signal)` is asked one ticket at a time. `PairRequest` is `{ code, model, address, link, engine, build }` (model normalized, `SM-A266B`) |
| `true` | a record `d-` + 4 hex, a 32-byte token; the phone gets `editor`/`paired { device, token, engine }`, `hub:device { kind: "connected" }` is emitted, the engine is refreshed through files, `hub:paired { id, model, link }` is logged (never the token) |
| `false`, a throw, a rejection | close 1008 `pairing refused` (a throw or rejection logged `hub:pair-failed`); the address cools down 10 s |
| `pairTimeoutMs` runs out | the signal aborts, close 1008 `pairing timed out`, cooldown |
| The socket closes while waiting | the signal aborts, a late answer pairs nothing, the next ticket is asked |

A token reconnect is paired at open: the record follows the new connection, an older live one is
closed 1001 `replaced` (announced `closed` with reason `replaced`, carrying the replaced
connection's address and link and `online: false`), then `connected` is emitted. The
log indices of the record are kept, so a resend after a reconnect is skipped.

### Device messages

A paired phone is an ordinary agent (hello first, heartbeats, values, taps, bye, responses,
strikes) that may also send `editor`/`perf.lines { log, from, lines }` at any time, before `hello`
too:

| Step | Rule |
|---|---|
| Check | `log` matches `^[\w.-]{1,128}$`, `from` a safe integer ≥ 0, `lines` 1–5000 items; else one strike and no ack |
| Duplicates | lines below the log's next index are skipped (a resend after a lost ack); a jump forward is a `gap` |
| Items | a plain object with a finite number `v` and a `kind` of 1–32 characters is kept (frozen, `PerfLogLine`); others are dropped and counted `rejected`, never a strike |
| Event | when items were kept or `gap > 0`: `hub:device { kind: "lines", device, lines: { log, from, rx, items, gap, rejected } }`, `rx` the computer's epoch ms at receipt |
| Ack | always: `editor`/`perf.ack { log, next, n }`, `next` cumulative, `n` the batch size |

At most 32 logs per device are tracked (the oldest is dropped). When a paired connection closes,
`hub:device { kind: "closed" }` is emitted with reason `bye` after a bye, else `lost`; every
`closed` event (`stopped` and `replaced` too) carries `device.online: false`. A pairing socket
that closes emits nothing. The record stays until device mode stops.

A device session carries `SessionInfo.device` `{ id, model, link, address, port, engine, build }`
(`port`: the device listener's real port), in `sessions()`, `sessions {list}` and the `session`
notifications. Tools requests reach it by the usual session choice (a device session is not
`embedded`).

### Security

| Listener | Who may connect | Credential |
|---|---|---|
| normal (`serve()`, 127.0.0.1:<game port>) | tools (`kind=tools`, `role=page`), game page (`kind=agent`) | hub token, loopback Host and Origin |
| device, adb (127.0.0.1:<devicePort>) | tools (same rules as normal, on this port), devices (`kind=agent role=device`) | tools: hub token; device: native Origin and pairing (auto-confirmed under `pairing: "lan"`) or its device token |
| device, LAN (<lan address>:<devicePort>) | devices only | native Origin and pairing confirmed by the person, then the device token |

A device token is 32 random bytes per device per device-mode run, compared timing-safe, never
logged, never sent to tools. Pairing is rate-limited per peer address: at most 4 open pairing
sockets (429), a 5 s first-message deadline, a 10 s cooldown after a refusal; at most 4 pairings
wait for the person and 16 devices pair per run. A LAN client never reaches the tools page, the hello route, a tools
socket or another editor route.

### `editor.engine`

The hub publishes `files.engine()` on start and, after a pairing or reconnect, again when
`files.refreshEngine()` answers another id (a rejection is logged `hub:engine-refresh-failed` at
debug and the last id stays). Every agent's `session` answer carries the id as `engine`; `paired`
carries it; tools get `editor/engine` with the `EngineInfo`, replayed to each tools page that
opens. The overlay compares it with the phone's `__MOKU_GAME_ENGINE__`.

### `hub/protocol`

The device-link and tools-link wire module, runtime-free: `src/plugins/hub/protocol/` imports
nothing outside its folder (no plugin, no kernel, no `node:` module, no Bun global, not
`registry/protocol`; it declares its own `LinkJson`). The agent's bridge and overlay and the MCP
bridge import it as `../hub/protocol`, never the hub plugin.

| Export | Kind | What |
|---|---|---|
| `LinkJson` | type | A JSON value of the device link (assignable both ways with `registry/protocol`'s `Json`) |
| `DeviceLinkKind` | type | `"adb" \| "lan"` |
| `DEVICE_UNPAIRED_CODE`, `DEVICE_UNPAIRED_REASON` | const | `4401`, `"unpaired"` |
| `PairParams`, `PairedParams`, `PerfLinesParams`, `PerfAckParams` | type | params of `pair`, `paired`, `perf.lines`, `perf.ack` |
| `EngineInfo` | type | the computer's engine `{ id, version, dist, patch? }` |
| `SessionDevice` | type | the device of a session |
| `DeviceLink` | type | the bridge's link state |
| `normalizeModel(raw)` | function | `" sm a266b "` → `"SM-A266B"`; empty → `null`; at most 64 characters |
| `parsePairParams(params)` | function | the checked `pair` params, or `undefined` |
| `baseAppId(appId)` | function | the app id without one trailing `.debug`: `"com.mokulabs.timber.debug"` → `"com.mokulabs.timber"` (connect and the collector compare app ids through it) |
| `parsePerfLinesParams(params)` | function | the checked `perf.lines` params, or `undefined` |
| `parseAddress(text)` | function | `{ host, port, text }` of `host:port` or `[ipv6]:port` (trimmed, port 1–65535), or `undefined` |
| `isLoopback(host)` | function | `true` for 127.0.0.0/8, `localhost`, `::1` |
| `RunFrom` | type | `"page" \| "mcp"`: who sent a run through the hub |
| `RUN_FROM_CAP`, `AgentCap`, `HelloCaps` | const, type | `"run-from"`, the capability names, and `{ caps? }`: what an agent adds to its `hello` when its bridge reads a stamped run |
| `capsOf(raw)` | function | the known capabilities of a hello's `caps`, each once (`["sections", "run-from"]` → `["run-from"]`; no list → `[]`) |
| `CLIENT_METHOD`, `ClientParams` | const, type | `"client"` and `{ name }`: the tools→hub notification that names the MCP client |
| `StampedRunParams` | type | `{ id, input?, from, client? }`: a run as the agent gets it |
| `clientNameOf(raw)` | function | `" Claude\nCode "` → `"ClaudeCode"`: control and bidi characters dropped, trimmed, at most 64 characters (`MAX_CLIENT_NAME`); empty or no string → `undefined` |

## Events

| Event | Direction | Payload | When |
|---|---|---|---|
| `hub:session` | emitted (global, `ServerEvents`) | `HubSession` `{ id, game, open, reason? }`, `reason` is `"bye"` or `"game_reloaded"` | a valid `hello` (`open: true`) and an agent close (`open: false`) |

| `files:project` | hooked (global, `ServerEvents`) | `ProjectState` | published as `editor.project` (kept, replayed to each tools page that opens) |
| `hub:device` | emitted (per-plugin, the hub's own; hooked by plugins that list `hubPlugin` in `depends`, the collector) | `HubDeviceEvent` | `listening` (`listenDevices`, `listenLan`, `stopLan`: the new `listen`), `connected` (a pairing or a token reconnect), `lines` (a `perf.lines` batch with new items or a gap), `closed` (`bye`, `lost`, `replaced`, `stopped`), `stopped` (`stopDevices`) |

```ts
const event: HubDeviceEvent = { kind: "connected", device: { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600, engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z", pairedAt: 1791986083963, online: true, latencyMs: null } };
```

`hub:session` and `hub:device` are not emitted from `onStop`. A throwing emit is logged as
`hub:emit-failed`.

Log events (`ctx.log`):

| Event | Level | Fields |
|---|---|---|
| `hub:started` | info | `path` |
| `hub:refused` | warn | `status`, `check` (`role` for a bad role), `host`, `origin` |
| `hub:session-open` | info | `id`, `game` |
| `hub:session-silent` | info | `id`, `paused` |
| `hub:session-alive` | info | `id` |
| `hub:emit-failed` | error | `id`, `error`; for `hub:device`: `event`, `kind`, `error` |
| `hub:devices-on` | info | `port`, `lan` |
| `hub:devices-off` | info | |
| `hub:devices-lan` | info | `lan` (the LAN listener's address after `listenLan`, `null` after `stopLan`) |
| `hub:paired` | info | `id`, `model`, `link` (never the token) |
| `hub:pair-refused` | info | `address`, `model` |
| `hub:pair-failed` | warn | `error` |
| `hub:device-unpaired` | info | `address`, `link` |
| `hub:engine-refresh-failed` | debug | `error` |
| `hub:open`, `hub:close` | debug | `kind`, `conn` |
| `hub:late-response` | debug | `id`. Also a page answer to a call that was not relayed to it. |
| `hub:unknown-notification` | debug | `channel`, `method` |
| `hub:tools-ignored` | debug | `method`. Also a `selection` or a response from a plain tools connection, and a `client` from the editor page. |
| `hub:tools-client` | debug | `conn`, `client` (the cleaned MCP client's name, or undefined) |
| `hub:published` | debug | `method`; for `project` also `bytes` (the frame size) and `conns` (the tools connections it went to) |

## Dependencies

| Kind | Name | Use |
|---|---|---|
| depends | `filesPlugin` | `engine` and `refreshEngine` for `editor.engine`; `list`, `read`, `write`, `writeDataUrl`, `readBinary`, `find` for the files channel. `writeBinary {path, data}` calls `writeDataUrl(path, data)`: a mime that does not match the path is -32602, a non-image path is -32004 |
| global event | `hub:session` | emitted |
| global event | `files:project` | hooked, published as `editor.project` |
| per-plugin event | `hub:device` | emitted, declared with `register<HubDeviceEvent>()` |
| protocol | `./protocol` (`hub/protocol`) | the device-link wire types, the 4401 constants, `normalizeModel`, `parsePairParams`, `parsePerfLinesParams`, `baseAppId` |
| protocol | `../perf/protocol` | type only: `PerfLogLine` of `DeviceLines.items` |
| protocol | `../registry/protocol` | `SessionInfo`, `commandsHash`, `SelectionInfo`, `PublishParams`, `ProjectFound`, `ProjectState`, `wireError`, `toWireError`, `toWireValue`, `checkInput`, `parseSelectionInfo`, `parseSelectParams`, `parseDeviceParams`, `parseShowParams`, `parseNodeParams`, `EditorRequests`, `RelayedEditorMethod`, `decode`, `encode` |

## Usage

```ts
import { createApp } from "@moku-labs/editor/server";
import index from "./index.html";

const editor = createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
await editor.start();
Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
```

React to sessions from another server plugin:

```ts
import { createPlugin, hubPlugin } from "@moku-labs/editor/server";

export const auditPlugin = createPlugin("audit", {
  depends: [hubPlugin],
  hooks: ctx => ({
    "hub:session": session => ctx.log.info("audit:session", { id: session.id, open: session.open })
  })
});
```

## Integration

| Plugin | Core | How it meets the hub |
|---|---|---|
| `files` | server | Answers the files channel. Its errors pass through unchanged. |
| `pages` | server | Depends on hub. In `onInit` it calls `addRoutes` for `{path}`, `{path}/`, `{path}/hello`, `{path}/assets/*`. Every route runs `guard` first (`navigate`, `same-origin` for hello). The boot JSON uses `path()` and `token()`. The bin passes `guard` to `createStaticFetch`. |
| `pages` MCP bridge | tools | A plain tools client: `editor.selection` and `editor.select` for the MCP tools. No `role`. |
| `bridge` | agent | Gets `{ ws, token }` from `{path}/hello`, opens `{path}/ws?token=…&kind=agent`, sends an Origin header outside a browser, sends `hello`, reads its id from the `session` notification on channel `editor`. |
| `link` | tools | Opens `{boot.ws}?token=…&kind=tools`, plus `&role=page` in the tools page (config `role: "page"`). The page notifies `selection` and answers relayed `select` requests. Computes silence itself from forwarded heartbeats (`SILENT_AFTER_MS`, `SILENT_AFTER_PAUSED_MS`). Reads `heap` from them and passes forwarded taps to `onTap`. Its own call timeout is `CALL_TIMEOUT_MS` (10 s), longer than the hub default of 5 s. |

Lifecycle:

| Phase | What happens |
|---|---|
| `onInit` | validates the config, builds the allowed origins |
| `onStart` | new token, silent check every `min(1000, silentAfterMs / 2)` ms (unref'd), `files.engine()` published as `editor.engine`. Device mode stays off. |
| `onStop` | clears timers, forgets connections, sessions, calls and watches, closes every socket with 1001 `editor stopping`. A kept selection becomes `null`. Later upgrades get 503. Then `teardownDevices`: pairings aborted, devices forgotten, the device listeners stopped (no emit, no log). The game's Bun server belongs to the game; the device listeners are the hub's. |

## Limits

- One `serve` per app. Loopback only. No `unix`, no `tls`.
- 32 MiB per frame. Bigger frames are closed by Bun (1009).
- 256 pending calls per tools connection, files calls and relayed editor calls included.
- `role` takes one value, `page`, and only with `kind=tools`.
- Binary frames are not accepted.
- A silent flip re-sends `sessions {list}` with the `heartbeat` readout, once per check. A new frame alone sends no list; the forwarded `heartbeat` carries it.
- No throttle of its own on frame sources. The bridge sends one value per heartbeat on change.
- `serve` and the device listeners' start each hold one `as unknown as BunServeOptions` cast of the Bun seam (oven-sh/bun#17871, #18314).
- Device mode: 16 devices per run, 4 pairings waiting, 4 open pairing sockets per address, a 5 s first-message deadline, a 10 s cooldown per refused address, 128 characters per device field of `pair`, 32 logs per device, 1–5000 lines per `perf.lines` batch.
- The per-address socket cap counts sockets Bun has opened: a burst of upgrades in the same instant can pass before the first opens; the 5 s deadline closes the extra ones.
- `editorPort` (the editor page URL of `no_editor_page`) comes from the normal listener only; a tools page on the adb listener does not change it.

## Files

| File | What |
|---|---|
| `index.ts` | wiring: config, the `hub:device` event, state, api, hooks, lifecycle |
| `types.ts` | config, state, api, device-mode and event types |
| `state.ts` | `createHubState` |
| `api.ts` | `createHubApi`: assembles the modules |
| `init.ts` | `onInit`: config checks, `state.origins`, `state.deviceOrigins` |
| `lifecycle.ts` | `onStart` (token, silent check, engine) and `onStop` (sockets, timers, device teardown) |
| `handlers.ts` | the `files:project` hook |
| `engine.ts` | `publishEngine`, `refreshAndPublish`: `editor.engine` from files |
| `serve.ts` | `serve()`, `addRoutes` |
| `security/` | `guard.ts` (Host / Origin), `token.ts`, `upgrade.ts` (the normal `{path}/ws`) |
| `sockets/` | `handler.ts` (the one websocket handler), `agent.ts`, `tools.ts`, `send.ts`, `close.ts` |
| `routing/` | sessions (with the hello's `caps`), calls (with `runParamsOf`), subscriptions, files channel, editor page relay, publish, `editor-methods.ts` (`addEditorMethods`, the call of a registered method) |
| `device/listen.ts` | `listenDevices`, `stopDevices`, `teardownDevices`, `listenLan`, `stopLan` |
| `device/ping.ts` | the once-a-second device ping and `latencyMs` |
| `device/lan.ts` | `lanAddressOf`: the LAN address to bind |
| `device/upgrade.ts` | `handleDeviceUpgrade`: the device listeners' `{path}/ws` |
| `device/pairing.ts` | pairing: the queue, the question, confirm and refusal |
| `device/connections.ts` | device sockets' open (4401, token reconnect) and close |
| `device/lines.ts` | `perf.lines`: `acceptLines`, `isLineShape`, the ack |
| `device/records.ts` | device ids, `LinkedDevice` copies, the `hub:device` emit |
| `protocol/` | the runtime-free wire module (`device-link.ts`, `tools-link.ts`, `index.ts`) |
