# bridge

> Complex plugin (agent core) — The websocket client that links the game page to the editor server (`hub`).

Opt-in and dev only. It is not in the agent's default plugins. A game's dev entry adds it:

```ts
const editor = createApp({
  plugins: __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [],
  pluginConfigs: { registry: { game: app, modules: [mergeDev] } }
});
await editor.start(); // never waits for the editor server
```

What it does:

1. **Hello.** On start it fetches the hello route (same origin, no cache) for `{ ws, token }`. It
   fetches it again on every attempt, because a hub restart rotates the token.
2. **Socket.** It opens `{ws}?token=…&kind=agent`. In a Bun process (told by the `Bun` global, not
   by `document`) it sends the hello origin as the `Origin` header (on the fetch and through Bun's
   `WebSocket` `headers` option).
3. **Hello first.** The first message is `hello { manifest }`, then a `heartbeat`.
4. **Requests.** It serves the hub's `manifest`, `read`, `watch`, `unwatch` and `run` through the
   in-process `channel`. Every request gets exactly one response.
5. **Values.** A `watch` of an `edge` or `commit` source follows `channel.watch`. A `frame` source is
   re-read once per heartbeat. After every `run`, every watched source is re-read. A value is sent
   only when its JSON changed. An `edge` or `commit` value that a run changed opens its
   `channel.watch` again, so the next frame is compared with the value sent last.
6. **Reconnect.** A failed hello or a closed socket schedules a new attempt with backoff.
7. **Bye.** On stop it sends `bye` and closes with 1000.

The token is never logged. Log lines name the hello origin and path only.

## API

`app.bridge` is `{ status(): LinkStatus; session(): string | undefined }`.

| Method | Result |
|---|---|
| `status()` | `{ kind: "connecting" }` before start and while connecting. `{ kind: "live" \| "paused", frame }` while open, from `channel.heartbeat()`. `{ kind: "lost", reason, lastFrame, retryInMs }` while lost (`retryInMs` 0 when no retry is scheduled). `{ kind: "lost", reason: "stopped", lastFrame, retryInMs: 0 }` after stop. Never `silent` or `empty`. |
| `session()` | The session id from the hub's `editor`/`session` notification after `hello`. `undefined` before it arrives and after the socket closes. |

```ts
editor.bridge.status(); // { kind: "live", frame: 1840 }
editor.bridge.session(); // "s-7f3a"
```

## Configuration

| Option | Default | Rule |
|---|---|---|
| `hello` | `"/__editor/hello"` | Non-empty string: a same-origin path or an absolute URL. |
| `retryMs` | `1000` | Whole number, at least 100. First reconnect delay; doubles per failure up to 30 s, ±20 % jitter. |
| `callTimeoutMs` | `5000` | Whole number, at least 100. Deadline of one `read` or `run`. A `run` of `editor.series` gets `min(input.durationMs, 60 000)` on top. |

```ts
createApp({ plugins: [bridgePlugin], pluginConfigs: { bridge: { retryMs: 500 } } });
```

## Wire

| Direction | Message |
|---|---|
| agent → hub | `hello { manifest }` (first), `heartbeat Heartbeat`, `value { sub, value }`, `bye` (channel `game`), and the responses |
| hub → agent | requests `manifest`, `read { id, input? }`, `watch { sub, id, input? }`, `unwatch { sub }`, `run { id, input? }` (channel `game`); notification `session { id, game, open }` (channel `editor`) |

- `sub` is a safe integer ≥ 0, else -32602 with field `sub`.
- Another method, or another channel than `game`, answers -32601 `unknown method …`.
- A request past its deadline answers -32002 `{ reason: "timeout", retryable: true, id }`. The command
  is not cancelled; its late result is dropped.
- Every error message starts with `[moku-editor] `. No stack is sent.
- While the socket holds more than 1 MiB, values wait in a backlog, the latest per sub. The backlog
  is sent on the next heartbeat below 256 KiB. Responses and heartbeats are always sent at once.

## Lifecycle

- **onInit:** validates `hello`, `retryMs` and `callTimeoutMs`.
- **onStart:** publishes `connecting`, listens to the channel heartbeat and to `visibilitychange`,
  then connects without awaiting. `app.start()` resolves even when no editor server answers.
- **onStop:** stops retries and deadlines, removes the listeners, ends every subscription, sends
  `bye` and closes with 1000 when the socket is open.

## Dependencies

- `registry`: `manifest()` for `hello` and `manifest`; `source(id)` for the change kind of a watch.
- `channel`: `read`, `watch`, `run`, `heartbeat`, `onHeartbeat`.

## Events

Emits the global agent event `bridge:status` `{ status: LinkStatus; session?: string }`, declared in
`src/config.ts`. It fires at start, on every change of the status kind, and on every session change.
A frame change alone does not emit. The overlay hooks it for its link dot.

```ts
hooks: () => ({ "bridge:status": ({ status, session }) => showDot(status.kind, session) })
```
