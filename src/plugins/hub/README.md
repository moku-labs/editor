# hub

> Complex plugin, server core. The editor's websocket switchboard inside a Bun server.

Checks Host, Origin and a per-start token before any upgrade. Runs the one websocket handler
Bun allows per server, with two connection kinds: `agent` (a game page) and `tools` (a tools
page). Keeps the game sessions. Routes game-channel requests from tools to the chosen session
and files-channel requests to `files`. Wraps the game's `Bun.serve` options with `serve`.

## Configuration

Set through `pluginConfigs.hub`. Checked in `onInit`; a bad value makes `createApp` throw a
`[moku-editor] hub.<field> …` error.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `path` | `string` | `"/__editor"` | URL prefix of every editor route. Starts with `/`. Letters, digits, `_`, `-`, `/`. No trailing or double slash. |
| `allowOrigins` | `readonly string[]` | `[]` | Extra exact http(s) origins allowed to upgrade and to call same-origin routes, for example `"http://192.168.1.4:3000"`. No path, no trailing slash. |
| `callTimeoutMs` | `number` | `5000` | Deadline of a forwarded call before it fails with -32002. Integer ≥ 100. |
| `silentAfterMs` | `number` | `6000` | A session with no heartbeat for this long is marked silent. Integer ≥ 100. After a `paused: true` heartbeat the limit is 65 s (`PAUSED_SILENT_AFTER_MS`). |

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
| `sessions` | `() => SessionInfo[]` | A fresh list ordered by `connectedAt`. |
| `fetch` | `(req: Request, server: HubServer) => Response \| undefined` | The `{path}/ws` upgrade handler. `undefined` after an upgrade, else a refusal. |
| `websocket` | `HubWebSocketHandler` | The one websocket handler. 32 MiB frames, 60 s idle, no deflate. |
| `addRoutes` | `(routes: EditorRoutes) => void` | Registers editor routes under the path. `serve` merges them. |
| `guard` | `(req: Request, server: HubServer, mode: GuardMode) => Response \| undefined` | The shared Host / Origin / Sec-Fetch-Site check. `undefined` means allowed, else a 403. |
| `publish` | `(method: "hotReload", params: HotReload) => void` | Sends server state to every tools page as `editor.<method>` and keeps the last value per method. A tools page that connects later gets it right after `sessions {list}`. |
| `path` | `() => string` | `config.path`. |

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
editor.hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", page: "http://127.0.0.1:3000/", embedded: true, connectedAt: 1790000000000, heartbeat: { frame: 1840, paused: false, silent: false } }]
```

`SessionInfo` has `id`, `game`, `page`, `embedded`, `connectedAt`. After the first heartbeat it
also has `heartbeat {frame, paused, silent}`: frame and paused of the last beat and the hub's
silent flag. `at`, `heap` and `lastBeatAt` stay private. Mutating the result does not change the
next call.

### `fetch(req, server)`

```ts
fetch: (req, server) => editor.hub.fetch(req, server) ?? new Response("upgraded")
```

`serve` already mounts it as `{path}/ws`. Upgrade URL: `{path}/ws?token=<t>&kind=agent|tools`.
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
| 7 | `server.upgrade` returns true | 400 | `invalid` |

### `websocket`

`open` registers the connection. A tools connection gets `sessions {list}` at once, then every
published value. A socket
that opens after stop is closed with 1001. `message` closes on a binary frame (1003) and decodes
text. `close` ends the agent's session or the tools subscriptions. `drain` flushes the tools
backlog.

### `addRoutes(routes)`

```ts
editor.hub.addRoutes({ "/__editor/hello": helloRoute });
```

Call it in `onInit`. Keys are checked first, so a refused batch registers nothing. Throws after
`serve`, on a key registered before, on `{path}/ws`, and on a key that is neither `path` nor
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
```

pages calls it from `attachServer` and after `setHotReload` (R6). The value is stored as a plain
copy in `state.published`, also before start. It is a state notification: sent while a tools
connection is congested too, never dropped. One method today: `hotReload`.

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
| `hello {manifest}`, manifest valid (`restored` absent or `{ bookmark: string, frame: number }`) | session opens, id `s-` + 4 hex. The agent gets `session {id, game, open: true}`. Tools get `session` and `sessions {list}`. `hub:session` is emitted. |
| `hello` with a bad manifest | close 1008 `bad manifest` |
| `hello` a second time | close 1008 `hello twice` |
| `heartbeat {frame, paused, at, heap?}` | stored, a silent session comes back, forwarded to every tools connection. When `paused` flips against the last beat, or a silent session comes back, tools first get `sessions {list}` again. `heap {usedMb, limitMb}` is kept when both are finite numbers. A malformed `heap` is dropped and the beat still goes through. |
| `value {sub, value}` | fanned out to the tools subscribers |
| `tap {x, y, at}` | forwarded to every tools connection with `session`, like a heartbeat. Only `x`, `y` and `at` are kept. |
| `bye` | the close reason becomes `bye` |
| Response to a forwarded call | settled to its target. An unknown id is a `hub:late-response` debug log. |
| Any request | error -32007 `unauthorized`, nothing dispatched |
| Malformed heartbeat, value or tap, undecodable text | one strike. Ten strikes close with 1008. |

Tools connection:

| Channel | Method | Params | Result |
|---|---|---|---|
| `game` | `manifest` | `{}` | `Manifest` of the chosen session |
| `game` | `read` | `{ id, input? }` | forwarded, `Json` |
| `game` | `run` | `{ id, input? }` | forwarded, `RunResult` |
| `game` | `watch` | `{ sub, id, input? }` | `null`, then `value {sub, value}` notifications |
| `game` | `unwatch` | `{ sub }` | `null` (an unknown sub is fine) |
| `files` | `list` | `{ dir }` | `FileEntry[]` |
| `files` | `read` | `{ path }` | `FileText` |
| `files` | `write` | `{ path, text, version? }` | `WriteResult` |
| `files` | `writeBinary` | `{ path, data }` (a data URL) | `WriteResult` |
| `files` | `readBinary` | `{ path }` | `FileBinary` |
| other | any | | -32601 |

Notifications and responses from tools are ignored. Before a game call is forwarded, the hub
checks the session choice, the id in the manifest and the input.

What a tools connection gets on channel `editor`: `sessions {list}` at open, then every published
value (`hotReload {hmr, owner}`); `session {…}` and `sessions {list}` on each session change;
`sessions {list}` again when a session's `paused` or `silent` flips (not on every frame);
`hotReload` again on each `publish`.

Errors the hub builds (message prefix `[moku-editor]`):

| Code | Reason | Retryable | When |
|---|---|---|---|
| -32001 | `game_reloaded` | yes | the agent closed while the call was pending |
| -32002 | `timeout` | yes | the call passed its deadline |
| -32003 | `no_session` | no | the named session is not open (`data.id`), or no game is connected |
| -32003 | `choose_session` | no | several sessions and not exactly one `embedded` |
| -32601 | `unknown_id` | no | the source or command id is not in the manifest (`data.id`) |
| -32601 | | no | unknown channel or method |
| -32602 | `invalid_input` | no | bad params or input; `sub` not a safe integer ≥ 0 |
| -32600 | | no | duplicate `sub` on one connection; more than 256 pending calls |
| -32007 | `unauthorized` | no | a request from an agent |

Files errors keep their own code and data. Any other throw becomes -32000 with the message
only, never a stack.

Session choice when a game request has no `session`: one open session wins; with several, the
only `embedded` one wins; otherwise -32003.

Deadline of a forwarded call: `callTimeoutMs`. A `run` of `editor.series` waits its
`input.durationMs` on top, up to 60 s more. The same rule runs in bridge and link.

Fan-out: one agent-side watch per `(session, source, input)`. The key sorts object keys, so
`{a, b}` and `{b, a}` share a watch. A late subscriber gets `null` and then the last value. The
last unwatch sends one `unwatch` to the agent.

Backpressure: when `send` returns -1 a tools connection is congested. Values coalesce to the
latest per `sub`, heartbeats and taps are dropped, responses, session and published
notifications are still sent.
`drain` flushes the backlog in order.

## Events

| Event | Direction | Payload | When |
|---|---|---|---|
| `hub:session` | emitted (global, `ServerEvents`) | `HubSession` `{ id, game, open, reason? }`, `reason` is `"bye"` or `"game_reloaded"` | a valid `hello` (`open: true`) and an agent close (`open: false`) |

Hooks nothing. Not emitted from `onStop`. A throwing emit is logged as `hub:emit-failed`.

Log events (`ctx.log`):

| Event | Level | Fields |
|---|---|---|
| `hub:started` | info | `path` |
| `hub:refused` | warn | `status`, `check`, `host`, `origin` |
| `hub:session-open` | info | `id`, `game` |
| `hub:session-silent` | info | `id`, `paused` |
| `hub:session-alive` | info | `id` |
| `hub:emit-failed` | error | `id`, `error` |
| `hub:open`, `hub:close` | debug | `kind`, `conn` |
| `hub:late-response` | debug | `id` |
| `hub:unknown-notification` | debug | `channel`, `method` |
| `hub:tools-ignored` | debug | `method` |

## Dependencies

| Kind | Name | Use |
|---|---|---|
| depends | `filesPlugin` | `list`, `read`, `write`, `writeBinary`, `readBinary` for the files channel |
| import | `decodeDataUrl` from `../files` | decodes `writeBinary` data; a mime that does not match the path is -32602, a non-image path is -32004 |
| global event | `hub:session` | emitted |
| protocol | `../registry/protocol` | `SessionInfo`, `wireError`, `toWireError`, `checkInput`, `decode`, `encode` |

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
| `bridge` | agent | Gets `{ ws, token }` from `{path}/hello`, opens `{path}/ws?token=…&kind=agent`, sends an Origin header outside a browser, sends `hello`, reads its id from the `session` notification on channel `editor`. |
| `link` | tools | Opens `{boot.ws}?token=…&kind=tools`. Computes silence itself from forwarded heartbeats (`SILENT_AFTER_MS`, `SILENT_AFTER_PAUSED_MS`). Reads `heap` from them and passes forwarded taps to `onTap`. Its own call timeout is `CALL_TIMEOUT_MS` (10 s), longer than the hub default of 5 s. |

Lifecycle:

| Phase | What happens |
|---|---|
| `onInit` | validates the config, builds the allowed origins |
| `onStart` | new token, silent check every `min(1000, silentAfterMs / 2)` ms (unref'd) |
| `onStop` | clears timers, forgets connections, sessions, calls and watches, closes every socket with 1001 `editor stopping`. Later upgrades get 503. The Bun server belongs to the game. |

## Limits

- One `serve` per app. Loopback only. No `unix`, no `tls`.
- 32 MiB per frame. Bigger frames are closed by Bun (1009).
- 256 pending calls per tools connection, files calls included.
- Binary frames are not accepted.
- A silent flip re-sends `sessions {list}` with the `heartbeat` readout, once per check. A new frame alone sends no list; the forwarded `heartbeat` carries it.
- No throttle of its own on frame sources. The bridge sends one value per heartbeat on change.
- `serve` holds the one `as unknown as BunServeOptions` cast of the Bun seam (oven-sh/bun#17871, #18314).
