# bridge

> Complex plugin (agent core). The websocket client that links the game page to the editor server (`hub`).

Opt-in and dev only. It is not in the agent's default plugins (`[registryPlugin, channelPlugin, overlayPlugin]`).
A game's dev entry adds it. It is exported from `@moku-labs/editor/agent` as `bridgePlugin`; its types as `Bridge`.

What it does:

1. **Hello.** On start it fetches the hello route (`cache: "no-store"`, `credentials: "same-origin"`)
   for `{ ws, token }`. It fetches it again on every attempt, because a hub restart rotates the token.
2. **Socket.** It opens `ws` resolved against the hello URL, `http:` as `ws:` and `https:` as `wss:`,
   with `token` and `kind=agent` on the query. In a Bun process (told by the `Bun` global, not by
   `document`) it sends the hello origin as the `Origin` header, on the fetch and through Bun's
   `WebSocket` `headers` option. A browser sets `Origin` itself.
3. **Hello first.** The first message is `hello { manifest }`, then a `heartbeat`.
4. **Requests.** It serves the hub's `manifest`, `read`, `watch`, `unwatch` and `run` through the
   in-process `channel`. Every request gets exactly one response.
5. **Values.** A `watch` of an `edge` or `commit` source follows `channel.watch`. A `frame` source is
   re-read once per heartbeat. After every `run`, every watched source is re-read. A value is sent
   only when its JSON text changed. An `edge` or `commit` value that a run changed opens its
   `channel.watch` again, so the next frame is compared with the value sent last.
6. **Reconnect.** A failed hello or a closed socket schedules a new attempt with backoff.
7. **Bye.** On stop it sends `bye` and closes with 1000.

The token is never logged. Log lines name the hello origin and path only.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `hello` | `string` | `"/__editor/hello"` | Hello route of the editor server. A same-origin path or an absolute URL. Non-empty. |
| `retryMs` | `number` | `1000` | First reconnect delay in ms. Doubles per failure up to `MAX_RETRY_MS` (30 000), ±20 % jitter. A whole number, at least 100. |
| `callTimeoutMs` | `number` | `5000` | Deadline of one `read` or `run` in ms. A `run` of `editor.series` gets `min(input.durationMs, 60 000)` on top. A whole number, at least 100. |

`onInit` checks the three options, so a bad value throws at `createApp`:

```
[moku-editor] bridge.retryMs must be a whole number of at least 100.
  Fix pluginConfigs.bridge.retryMs, for example 1000.
```

Constants in `types.ts`:

| Constant | Value | Use |
|---|---|---|
| `MAX_RETRY_MS` | `30_000` | Cap of the reconnect delay. |
| `JITTER` | `0.2` | ±20 % on every delay. |
| `HIGH_WATER` | `1_048_576` | Buffered bytes above which values wait in the backlog (1 MiB). |
| `LOW_WATER` | `262_144` | Buffered bytes below which the backlog is sent (256 KiB). |
| `DEADLINE_EXTRA_CAP_MS` | `60_000` | Cap of the `durationMs` extension. |
| `SERIES_ID` | `"editor.series"` | The one long call. |

Backoff: `nextDelay(attempt, retryMs, random)`. With the defaults and `random() = 0.5`:
1000, 2000, 4000, 8000, 16000, 30000, 30000.

## API

`app.bridge` is `BridgeApi`: `{ status(): LinkStatus; session(): string | undefined }`. Both methods read state only.

| Member | Signature | Result |
|---|---|---|
| `status` | `status(): LinkStatus` | `{ kind: "connecting" }` before start and while connecting. `{ kind: "live" \| "paused", frame }` while open, from `channel.heartbeat()`. `{ kind: "lost", reason, lastFrame, retryInMs }` while lost (`retryInMs` is 0 when no retry is scheduled). `{ kind: "lost", reason: "stopped", lastFrame, retryInMs: 0 }` after stop. Never `silent` or `empty`: those are tools-side states. |
| `session` | `session(): string \| undefined` | The session id from the hub's `editor`/`session` notification after `hello`. `undefined` before it arrives and after the socket closes. |

```ts
editor.bridge.status(); // { kind: "live", frame: 1840 }
editor.bridge.session(); // "s-7f3a"
```

Lost reasons:

| Reason | Retry |
|---|---|
| `no WebSocket in this runtime` | no |
| `no page URL for <hello>` (relative `hello` and no page URL) | no |
| `hello unreachable` | yes |
| `hello <status>` (404: no editor server, 403: not same-origin) | yes |
| `hello answered without ws and token` | yes |
| `hello answered a bad ws URL` | yes |
| `socket failed` | yes |
| `socket closed (<code>)`, plus `: <reason>` when the hub gave one (1008 `hello first`, 1001 `editor stopping`) | yes |
| `stopped` | no |

## Events

| Event | Direction | Payload | When |
|---|---|---|---|
| `bridge:status` | emitted | `{ status: LinkStatus; session?: string }` | At start (`connecting`), on every change of the status kind, and on every session change. A frame change alone does not emit. `session` is left out when there is none. |

`bridge:status` is a global agent event, declared in `AgentEvents` in `src/config.ts`. The bridge has
no `events` field. `onStop` emits nothing (teardown context).

The bridge hooks no events.

## Dependencies

| Plugin | Used |
|---|---|
| `registry` | `manifest()` for `hello` and the `manifest` request. `source(id)` for the `changes` kind of a watched source. |
| `channel` | `read`, `watch`, `run` for every game request. `heartbeat()` and `onHeartbeat(fn)` for beats, the status, the backlog and frame sampling. |

`depends: [registryPlugin, channelPlugin]`. Global event used: `bridge:status` (emitted).
It uses the platform `fetch` and `WebSocket`. No package dependency.

## Usage

```ts
import { bridgePlugin, capturePlugin, createApp } from "@moku-labs/editor/agent";

const editor = createApp({
  plugins: __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [],
  pluginConfigs: {
    registry: { game: app, modules: [mergeDev] },
    bridge: { retryMs: 500 }
  }
});
await editor.start(); // never waits for the editor server
editor.bridge.status(); // { kind: "connecting" }, then { kind: "live", frame: 12 }
```

From another agent plugin, hook the global event. No dependency on the bridge is needed:

```ts
hooks: () => ({ "bridge:status": ({ status, session }) => showDot(status.kind, session) })
```

## Lifecycle

| Phase | What happens |
|---|---|
| `onInit` | `checkConfig`: `hello` non-empty, `retryMs` and `callTimeoutMs` whole numbers of at least 100. |
| `onStart` | `startBridge`: publishes `connecting`, listens to `channel.onHeartbeat` and to `visibilitychange`, then connects without awaiting. `app.start()` resolves even when no editor server answers. |
| `onStop` | `stopBridge`: phase `stopped`, clears the retry timer and every deadline, removes the listeners, ends every subscription, clears the session. An open socket gets `bye` and close 1000. A socket that is not open yet is closed. A hello fetch still in flight opens nothing. |

Heartbeat tick, only while open: send the beat (always, even when congested), update the status,
send the backlog when below `LOW_WATER`, then re-read every `frame` subscription (skipped while congested).

A `visibilitychange` (either way) sends one heartbeat in a microtask while open.

Log events:

| Event | Level | When |
|---|---|---|
| `bridge:connected` | info | Socket open. `{ url }` is the hello origin and path. |
| `bridge:lost` | warn, then debug | First failure of a streak at warn, the rest at debug. `{ reason, retryInMs }`. |
| `bridge:disabled` | error | A failure without retry. `{ reason }`. |
| `bridge:connect-crashed`, `bridge:request-crashed` | error | An unexpected throw in the connect loop or in a request. |
| `bridge:late-result`, `bridge:sample-failed`, `bridge:refresh-failed`, `bridge:send-failed`, `bridge:socket-error`, `bridge:binary-ignored`, `bridge:bad-message`, `bridge:notification-ignored` | debug | Dropped or failed work that changes no state. |

## Integration notes

**Wire (with `hub`).**

| Direction | Message |
|---|---|
| agent to hub | `hello { manifest }` (first), `heartbeat Heartbeat`, `value { sub, value }`, `bye` (channel `game`), and the responses |
| hub to agent | requests `manifest`, `read { id, input? }`, `watch { sub, id, input? }`, `unwatch { sub }`, `run { id, input? }` (channel `game`). Notification `session { id, game, open }` (channel `editor`). |

- `sub` is a safe integer of at least 0, else -32602 with field `sub`.
- Another method, or another channel than `game`, answers -32601 `unknown method …`.
- A `watch` of an unknown source answers -32601 with reason `unknown_id`.
- The `watch` response (`null`) goes on the socket before the first value.
- A `read` or `run` past its deadline answers -32002 `{ reason: "timeout", retryable: true, id }`.
  The command is not cancelled. Its late result is dropped.
- Every error message starts with `[moku-editor] `. No stack is sent.
- While the socket holds more than 1 MiB, values wait in a backlog, the latest per sub. Responses
  and heartbeats are always sent at once.
- Binary frames, undecodable text and responses from the hub are ignored.

**`hub`.** It closes an agent with 1008 `hello first` when anything else comes first. After `hello` it
sends the `editor`/`session` notification that `session()` reads. It shares one agent-side watch
between tools subscribers and has no throttle of its own: the bridge throttles `frame` sources.
On close without `bye` the hub ends the session with `game_reloaded` and fails pending calls -32001.
A session is silent after `silentAfterMs` (hub default 6000), or after 65 s when the last beat said `paused: true`.

**`pages`.** It serves `{path}/hello` (default `/__editor/hello`), same-origin only. That is the
default of `hello`.

**`overlay`.** It hooks `bridge:status` for its link dot and checks `ctx.has("bridge")` at start.
In a build without the bridge the event never fires.

**`capture`.** Added next to the bridge. Its `editor.series` command is the long call that gets
`durationMs` on top of the deadline. `hub` and `link` use the same rule.

## Limits

- No cancel. A timed-out command keeps running in the game. Its result is dropped.
- The post-run re-read runs when the `run` settles. A `run` that never settles re-reads nothing.
- `frame` sources update once per channel heartbeat (`heartbeatMs`, default 1000), not per frame.
- A page reload sends no `bye`. The tools page sees `game_reloaded`.
- A hidden tab under Chrome's intensive throttling beats about once a minute. Hub and link wait
  65 s before `silent` because the last beat said `paused: true`.
- `no WebSocket in this runtime` and `no page URL for <hello>` schedule no retry. The status stays `lost` with `retryInMs: 0`.
