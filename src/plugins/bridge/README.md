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
6. **Taps.** A `pointerdown` on the page window sends `tap { x, y, at }`: page CSS px
   (`clientX`, `clientY`) and the page's `performance.now()`. At most one per 50 ms
   (`TAP_THROTTLE_MS`), only while open. Overlay input sends none.
7. **Reconnect.** A failed hello or a closed socket schedules a new attempt with backoff.
8. **Bye.** On stop it sends `bye` and closes with 1000.
9. **Checkpoint across Bun's full reload (R6).** See [Checkpoint](#checkpoint).
10. **`editor.reload`.** A registry command that stores the same checkpoint and reloads the page
    on request (the MCP tool `moku_reload`). See [editor.reload](#editorreload).

The token is never logged. Log lines name the hello origin and path only.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `hello` | `string` | `"/__editor/hello"` | Hello route of the editor server. A same-origin path or an absolute URL. Non-empty. |
| `retryMs` | `number` | `1000` | First reconnect delay in ms. Doubles per failure up to `MAX_RETRY_MS` (30 000), ±20 % jitter. A whole number, at least 100. |
| `callTimeoutMs` | `number` | `5000` | Deadline of one `read` or `run` in ms. A `run` of `editor.series` gets `min(input.durationMs, 60 000)` on top, a `run` of `editor.sheet` `min(input.frames × input.everyMs, 60 000)`. A whole number, at least 100. |

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
| `DEADLINE_EXTRA_CAP_MS` | `60_000` | Cap of the long-call extension. |
| `SERIES_ID` | `"editor.series"` | The long call that waits its `durationMs` on top. |
| `SHEET_ID` | `"editor.sheet"` | The long call that waits its `frames × everyMs` on top. |
| `RELOAD_ID` | `"editor.reload"` | The command the bridge adds to the registry. |

Backoff: `nextDelay(attempt, retryMs, random)`. With the defaults and `random() = 0.5`:
1000, 2000, 4000, 8000, 16000, 30000, 30000.

## Checkpoint

Bun HMR reloads the game page after a source save (D-23). Bun cannot be held:
`bun:beforeFullReload` only notifies. So the bridge keeps the game state across the reload:

1. On `import.meta.hot.on("bun:beforeFullReload")` it reads the clock and runs `game.bookmark`
   through its registry entry. The door runs at once, not a microtask later as through
   `channel.run`. When the run settles (microtasks, before the reload) it stores
   `{ v: 1, doc, at, frame, paused, bookmark }` as JSON in `sessionStorage["moku-editor:checkpoint"]`.
   `doc` is `performance.timeOrigin` of the page.
2. On start, the bridge of the next page takes a checkpoint stored by another document, removes
   it, runs `game.restore { bookmark }`, then `game.pause` when it was paused, and only then
   connects. Its first hello carries `manifest.restored = { bookmark, frame }`: `bookmark` is the
   JSON text of the restored bookmark, `frame` the frame of the old page. Later hellos do not.
3. Without a checkpoint it connects at once, as before.

| Case | What happens |
|---|---|
| No Bun HMR (`import.meta.hot` undefined: a production build, Vite, a test) | No listener; nothing stored. |
| No `sessionStorage`, or reading it throws (a sandboxed frame) | Nothing stored, nothing restored. |
| The game has no `game.bookmark` | Nothing stored. |
| A checkpoint stored by this same document | Left in place: Bun runs the new code in the old page before it reloads it (spike), so an agent started there must not take it. |
| A checkpoint older than 30 s (`CHECKPOINT_MAX_AGE_MS`), or malformed | Removed, not restored. |
| `game.restore` missing or failing | `bridge:restore-failed` warn; no `restored` in hello. workspace's own restore (D-07) is the fallback. |
| `game.pause` failing after a restore | `bridge:pause-failed` warn; `restored` is still sent. |

Spike (Bun 1.3.14, Chromium, a module in `node_modules` like the published agent):

- `import.meta.hot.on(…)` must be written in the direct form behind `if (import.meta.hot)`. A stored
  `const hot = import.meta.hot` and `import.meta.hot?.on(…)` both throw "import.meta.hot.on cannot be
  used indirectly".
- `bun:beforeFullReload` fires in the old page; Bun then runs the new code in the old page, then
  loads the new page. A sessionStorage write made a few microtasks after the event survives into
  the new page. The new page takes it; the old page's re-run leaves it (same `doc`).

## editor.reload

The bridge adds one command to the registry in `onInit` (`reload.ts`, `reloadEntry`):

| Command | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.reload` | `"Reload the page"` | `{ restore: "boolean?" }` | `route` | `{ scheduled: true }` |

1. Checks the input. `restore` defaults to `true`. A non-boolean `restore` or an unknown field is
   refused with -32602, and nothing is scheduled.
2. With `restore`, it stores the checkpoint exactly as `bun:beforeFullReload` does
   (`takeCheckpoint`: clock, `game.bookmark`, `sessionStorage["moku-editor:checkpoint"]`) and waits
   for the store. A checkpoint that cannot be taken logs `bridge:checkpoint-failed`; the reload
   still happens. `restore: false` stores nothing.
3. It answers `{ scheduled: true }` with `state` = `registry.envelope()`.
4. On the next macrotask, after the answer went out, it calls `location.reload()` (`reloadPage` of
   the reload seam; a no-op outside a browser page). `onStop` before then cancels it.
5. The bridge of the new document restores the checkpoint and sends `restored` in its first hello,
   as after Bun's full reload. The hub ends the old session with `game_reloaded`.

The effect is `route`, not `raw`: the registry refuses `cheat` and `raw` for editor commands
(they bypass the game's journal). The reload taints nothing itself; the restore in the new
document runs `game.restore` through the game, which does.

```ts
await link.run("editor.reload"); // { value: { scheduled: true }, state: { path, frame, tainted } }
await link.run("editor.reload", { restore: false }); // a fresh start, no checkpoint
```

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
| `registry` | `manifest()` for `hello` and the `manifest` request. `source(id)` for the `changes` kind of a watched source. `command(id)` for `game.bookmark`, `game.restore` and `game.pause` of the checkpoint, `clock()` for its frame and pause flag. `add(entry)` for `editor.reload` in `onInit`, `envelope()` for its `state`. |
| `channel` | `read`, `watch`, `run` for every game request. `heartbeat()` and `onHeartbeat(fn)` for beats, the status, the backlog and frame sampling. |

`depends: [registryPlugin, channelPlugin]`. Global event used: `bridge:status` (emitted).
It uses the platform `fetch`, `WebSocket`, `sessionStorage`, `location.reload()` and Bun's `import.meta.hot`. No package dependency.

## Usage

```ts
import { bridgePlugin, capturePlugin, createApp } from "@moku-labs/editor/agent";

const devPlugins = __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [];
const editor = createApp({
  plugins: devPlugins,
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
| `onInit` | `initBridge`: `checkConfig` (`hello` non-empty, `retryMs` and `callTimeoutMs` whole numbers of at least 100), then `registry.add` of `editor.reload`. A duplicate id throws at `createApp`. |
| `onStart` | `startBridge`: publishes `connecting`, listens to `channel.onHeartbeat`, to `visibilitychange`, to `pointerdown` on the window and to Bun's `bun:beforeFullReload`. With a stored checkpoint it restores it first; then it connects without awaiting. `app.start()` resolves even when no editor server answers. |
| `onStop` | `stopBridge`: phase `stopped`, clears the retry timer and every deadline, removes the listeners and a pending `editor.reload`, ends every subscription, clears the session. An open socket gets `bye` and close 1000. A socket that is not open yet is closed. A hello fetch still in flight opens nothing. |

Heartbeat tick, only while open: send the beat (always, even when congested), update the status,
send the backlog when below `LOW_WATER`, then re-read every `frame` subscription (skipped while congested).

A `visibilitychange` (either way) sends one heartbeat in a microtask while open.

`watchTaps` listens to `pointerdown` on the window in the capture phase, so a game that stops the
event at its canvas still sends the tap, and passive, so it never delays the game's input. The
overlay stops its own input at its host, but a window capture listener runs first, so the tap watch
skips any event whose path holds the overlay host (`HOST_ATTRIBUTE`, `data-moku-editor-overlay`,
from the protocol, the marker overlay sets). A tap dropped
because the bridge is not open does not count for the 50 ms throttle. Outside a browser (no
`window`) it does nothing.

Log events:

| Event | Level | When |
|---|---|---|
| `bridge:connected` | info | Socket open. `{ url }` is the hello origin and path. |
| `bridge:lost` | warn, then debug | First failure of a streak at warn, the rest at debug. `{ reason, retryInMs }`. |
| `bridge:disabled` | error | A failure without retry. `{ reason }`. |
| `bridge:connect-crashed`, `bridge:request-crashed` | error | An unexpected throw in the connect loop or in a request. |
| `bridge:restored` | info | A checkpoint was restored at start. `{ frame }`. |
| `bridge:checkpoint-failed`, `bridge:restore-failed`, `bridge:pause-failed` | warn | The checkpoint could not be taken or stored, restored, or the game paused again. `{ message }`. |
| `bridge:late-result`, `bridge:sample-failed`, `bridge:refresh-failed`, `bridge:send-failed`, `bridge:socket-error`, `bridge:binary-ignored`, `bridge:bad-message`, `bridge:notification-ignored` | debug | Dropped or failed work that changes no state. |

## Integration notes

**Wire (with `hub`).**

| Direction | Message |
|---|---|
| agent to hub | `hello { manifest }` (first; `manifest.restored` once after a checkpoint restore), `heartbeat Heartbeat` (with `heap` in Chromium), `value { sub, value }`, `tap Tap`, `bye` (channel `game`), and the responses |
| hub to agent | requests `manifest`, `read { id, input? }`, `watch { sub, id, input? }`, `unwatch { sub }`, `run { id, input? }` (channel `game`). Notification `session { id, game, open }` (channel `editor`). |

- `sub` is a safe integer of at least 0, else -32602 with field `sub`.
- Another method, or another channel than `game`, answers -32601 `unknown method …`.
- A `watch` of an unknown source answers -32601 with reason `unknown_id`.
- The `watch` response (`null`) goes on the socket before the first value.
- A `read` or `run` past its deadline answers -32002 `{ reason: "timeout", retryable: true, id }`.
  The command is not cancelled. Its late result is dropped.
- Every error message starts with `[moku-editor] `. No stack is sent.
- While the socket holds more than 1 MiB, values wait in a backlog, the latest per sub. Responses,
  heartbeats and taps are always sent at once.
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

**`capture`.** Added next to the bridge. Its `editor.series` and `editor.sheet` commands are the
long calls: `durationMs`, or `frames × everyMs`, on top of the deadline. `hub` and `link` use the
same rule.

## Limits

- No cancel. A timed-out command keeps running in the game. Its result is dropped.
- The post-run re-read runs when the `run` settles. A `run` that never settles re-reads nothing.
- `frame` sources update once per channel heartbeat (`heartbeatMs`, default 1000), not per frame.
- A page reload sends no `bye`. The tools page sees `game_reloaded`. This holds for `editor.reload` too.
- A hidden tab under Chrome's intensive throttling beats about once a minute. Hub and link wait
  65 s before `silent` because the last beat said `paused: true`.
- `no WebSocket in this runtime` and `no page URL for <hello>` schedule no retry. The status stays `lost` with `retryInMs: 0`.
