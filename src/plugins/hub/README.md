# hub

> Complex plugin (server core) — The editor's websocket switchboard inside a Bun server.

Checks Host, Origin and a per-start token before any upgrade. Runs the one websocket handler
Bun allows per server, with two connection kinds: `agent` (a game page) and `tools` (a tools
page). Keeps the game sessions. Routes game-channel requests from tools to the chosen session
and files-channel requests to `files`.

```ts
import { createApp } from "@moku-labs/editor/server";

const editor = createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
await editor.start();
Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
```

## API

| Method | What it does |
|---|---|
| `serve(options)` | Wraps the game's `Bun.serve` options. Forces `127.0.0.1`. Adds the editor routes and the websocket handler. Throws before start, on a second call, on `0.0.0.0` / `::` / a LAN IP, on `unix` / `tls`, on a `websocket`, and on a game route under the editor path. |
| `token()` | The token of this start (43 characters). Throws before start and after stop. Never logged. |
| `sessions()` | A fresh `SessionInfo[]` ordered by `connectedAt`. |
| `fetch(req, server)` | The `{path}/ws` upgrade handler. `undefined` after an upgrade, else a refusal. |
| `websocket` | The one websocket handler (32 MiB frames, 60 s idle, no deflate). |
| `addRoutes(routes)` | Registers editor routes under the path (pages, in `onInit`). `serve` merges them. |
| `guard(req, server, mode)` | The shared Host / Origin / Sec-Fetch-Site check: `upgrade`, `same-origin` or `navigate`. |
| `path()` | `config.path`. |

Upgrade checks, in order: path (404), started (503), `GET` + `Upgrade: websocket` (426),
Host then Origin (403; Origin is required), token (401), `kind=agent|tools` (400).

Wire rules:

- An agent must send `hello {manifest}` first, or it is closed with 1008.
- After `hello` the agent gets `session {id, game, open: true}` on channel `editor`.
- Any request from an agent gets -32007 `unauthorized`.
- Tools requests are checked before forwarding: session choice (-32003), id in the manifest (-32601), input (-32602).
- A tools connection can have at most 256 calls pending (-32600).
- Forwarded calls time out with -32002. A `run` of `editor.series` waits its `durationMs` on top, up to 60 s more.
- When an agent closes, its pending calls fail with -32001. Both errors are retryable.
- Watches fan out: one agent watch per `(session, source, input)`.
- Binary frames close the socket with 1003. Ten undecodable frames close it with 1008.

## Configuration

| Option | Default | Rule |
|---|---|---|
| `path` | `"/__editor"` | Starts with `/`, letters, digits, `_`, `-`, `/`. No trailing or double slash. |
| `allow` | `[]` | Extra exact http(s) origins, for example `"http://192.168.1.4:3000"`. |
| `callTimeoutMs` | `5000` | Integer ≥ 100. |
| `silentAfterMs` | `6000` | Integer ≥ 100. A session with a `paused: true` heartbeat counts as silent after 65 s. |

## Events

- Emits the global server event `hub:session` (`{ id, game, open, reason? }`). It fires on a valid `hello` and on agent close.
- Hooks nothing.

## Lifecycle

- `onInit` validates the config and builds the allowed origins.
- `onStart` creates a new token and starts the silent check.
- `onStop` closes every socket with 1001 and forgets every session. Later upgrades get 503. The Bun server belongs to the game.
