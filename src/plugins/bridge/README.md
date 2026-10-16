# bridge

> Complex plugin (agent core). The websocket client that links the game page to the editor server (`hub`).

Opt-in. It is not in the agent's default plugins (`[registry, channel, perf, recorder, overlay]`).
A game's dev entry, and the page agent of a debug build, add it. It is exported from
`@moku-labs/editor/agent` as `bridgePlugin`; its types as `Bridge`. It depends on `registry`,
`channel` and `recorder` (it pulls the recorder's log; the recorder never imports the bridge).

It runs in one of two modes, decided at start (see [Device mode](#device-mode)):

- **Page mode**: a page the dev server served. Everything below (hello, socket, requests, taps,
  checkpoint) is page mode.
- **Device mode**: a debug build on a phone with no dev server. It dials a computer address on the
  hub's device listener, pairs by a code, and ships the recorder's log.

What it does:

1. **Hello.** On start it fetches the hello route (`cache: "no-store"`, `credentials: "same-origin"`)
   for `{ ws, token }`. It fetches it again on every attempt, because a hub restart rotates the token.
2. **Socket.** It opens `ws` resolved against the hello URL, `http:` as `ws:` and `https:` as `wss:`,
   with `token` and `kind=agent` on the query. In a Bun process (told by the `Bun` global, not by
   `document`) it sends the hello origin as the `Origin` header, on the fetch and through Bun's
   `WebSocket` `headers` option. A browser sets `Origin` itself.
3. **Hello first.** The first message is `hello { manifest, caps: ["run-from"] }`, then a
   `heartbeat`. `caps` asks the hub to stamp who sent each `run` (an older hub ignores it).
4. **Requests.** It serves the hub's `manifest`, `read`, `watch`, `unwatch` and `run` through the
   in-process `channel`. Every request gets exactly one response. A `run` runs with the `via` of
   the hub's `from` stamp and, for an agent, its MCP client's name (see
   [Who ran a command](#who-ran-a-command)).
5. **Values.** A `watch` of an `edge` or `commit` source follows `channel.watch`. A `frame` source is
   re-read once per heartbeat. After every `run`, every watched source is re-read. A value is sent
   only when its JSON text changed. An `edge` or `commit` value that a run changed opens its
   `channel.watch` again, so the next frame is compared with the value sent last.
6. **Taps.** A `pointerdown` on the page window sends `tap { x, y, at }`: page CSS px
   (`clientX`, `clientY`) and the page's `performance.now()`. At most one per 50 ms
   (`TAP_THROTTLE_MS`), only while open. Overlay input sends none.
7. **Reconnect.** A failed hello or a closed socket schedules a new attempt with backoff. Every
   connect starts a new generation: a hello answer or failure that arrives after a newer connect
   (`connect(address)`, `overlay:connect`) opens nothing and fails nothing.
8. **Bye.** On stop it sends `bye` and closes with 1000.
9. **Checkpoint across Bun's full reload (R6).** See [Checkpoint](#checkpoint).
10. **`editor.reload`.** A registry command that stores the same checkpoint and reloads the page
    on request (the MCP tool `moku_reload`). See [editor.reload](#editorreload).
11. **`editor.clock`.** A read-only registry command that answers the game clock and why it stands
    (the MCP door tool `editor_clock`). See [editor.clock](#editorclock).

The token is never logged. Log lines name the hello origin and path, or the device address, never a
query, a device id or a device token.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `hello` | `string` | `"/__editor/hello"` | Hello route of the editor server. A same-origin path or an absolute URL. Non-empty. |
| `retryMs` | `number` | `1000` | First reconnect delay in ms. Doubles per failure up to `MAX_RETRY_MS` (30 000), ±20 % jitter. A whole number, at least 100. |
| `callTimeoutMs` | `number` | `5000` | Deadline of one `read` or `run` in ms. A `run` of `editor.series` gets `min(input.durationMs, 60 000)` on top, a `run` of `editor.sheet` `min(input.frames × input.everyMs, 60 000)`. A whole number, at least 100. |

| `device` | `string \| undefined` | `undefined` | Device mode at this computer address (`host:port`, `[v6]:port`). Undefined: the mode follows [Mode and address](#mode-and-address). |
| `linesPerBatch` | `number` | `200` | Most log lines in one `perf.lines` message. A whole number from 1 to 1000. |

`callTimeoutMs` is also the deadline of one `perf.ack`.

`onInit` checks the five options, so a bad value throws a `TypeError` at `createApp`:

```
[moku-editor] bridge.retryMs must be a whole number of at least 100.
  Fix pluginConfigs.bridge.retryMs, for example 1000.
[moku-editor] bridge.device must be host:port, for example "192.168.1.5:47600".
  Fix pluginConfigs.bridge.device, for example "127.0.0.1:47600".
[moku-editor] bridge.linesPerBatch must be a whole number from 1 to 1000.
  Fix pluginConfigs.bridge.linesPerBatch, for example 200.
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
| `DEFAULT_DEVICE_ADDRESS` | `"127.0.0.1:47600"` | The address when nothing else names one (adb reverse to the hub's `devicePort`). |
| `DEFAULT_LINES_PER_BATCH` | `200` | Default of `linesPerBatch`. |
| `MAX_LINES_PER_BATCH` | `1000` | Upper bound of `linesPerBatch`. |
| `SEEN_EMIT_MS` | `1000` | While linked in device mode, at most one `bridge:status` per second for the last sign alone. |
| `PAIRING_STORE_KEY` | `"moku-editor:link"` | The `localStorage` key of the remembered links. |
| `MAX_REMEMBERED` | `4` | Most remembered addresses; the oldest is dropped. |
| `PAIRING_REFUSED` | `"pairing refused"` | The hub's 1008 close reason after a refusal: no retry. |

Backoff: `nextDelay(attempt, retryMs, random)`. With the defaults and `random() = 0.5`:
1000, 2000, 4000, 8000, 16000, 30000, 30000.

## Device mode

### Mode and address

At start the bridge reads `localStorage["moku-editor:link"]` and decides (first match wins):

| # | Condition | Mode | Address |
|---|---|---|---|
| 1 | `__MOKU_GAME_EDITOR__` is a non-empty string (a debug build, `--editor host:port`) | device | remembered last ?? `device` ?? the build's address |
| 2 | config `device` is set | device | remembered last ?? `device` |
| 3 | a page URL that is not http(s) (`tauri://localhost` on iOS, `file:`), the native WebView's own host (`http://tauri.localhost` on Android), or no page URL with a `hello` that is not an absolute http(s) URL | device | remembered last ?? `127.0.0.1:47600` |
| 4 | otherwise (a page the dev server served; also a page without a URL whose `hello` names its server: a headless agent in Bun) | page | none |

The remembered address wins: the person chose it on the device after the build was made. An address
`parseAddress` refuses is skipped; a build address it refuses is warned about once
(`bridge:bad-address`), because the engine's `--editor` rule (`[\w.-]+` hosts) is wider than ours.
`connect(address)` and `overlay:connect` always switch to device mode, also on a dev page.

### Connect sequence

1. No hello fetch. The socket is `ws://<address>{path}/ws?kind=agent&role=device`, plus
   `&device=<id>&token=<token>` when the device has credentials for the address (both or
   neither). `{path}` is the path of `hello` with its last segment replaced by `ws`. Always `ws:`:
   debug builds allow cleartext. The bridge sends no Origin: the WebView sets the native one, which
   the hub allowlists (`deviceOrigins`).
2. **With credentials**, the open socket runs the link step: `hello { manifest }` first (the
   manifest carries `build { profile, id, engine }`), a heartbeat, live or paused, log shipping.
3. **Without credentials**, the open socket pairs: phase `pairing`, a four-digit code (from
   `crypto.getRandomValues`, leading zeros kept, the same code across retries until paired or
   refused), and `editor`/`pair { code, device: { model?, os?, engine?, build? } }` as the first
   message. `bridge:status` shows `link: { mode: "connecting", address, pairing: { code } }`.
   Over adb under the hub's `pairing: "lan"` the hub confirms at once.
4. `editor`/`paired { device, token, engine }` stores the device id and token for the address,
   remembers the address as the last one, keeps the computer's engine and runs the link step on
   the same socket.

| Close | What the bridge does |
|---|---|
| 4401 `unpaired` on a credentialed socket (the hub does not know the token: a restarted `moku-editor perf`) | Drops the address's credentials from the store and dials again at once, without credentials: the next socket pairs. No backoff. |
| 1008 `pairing refused` | Lost with `retryInMs: 0`, warn `bridge:pairing-refused`. No retry until `connect()` or `overlay:connect`. |
| any other (1008 `pairing timed out`, 1001, 1012, a 4401 on a pairing socket) | The usual backoff; the pairing code is kept. |
| a socket that never opened (1006: no computer, a refused upgrade) | The usual backoff; the credentials are kept. |

**Quiet when no computer.** Until the computer first answers a hello with a `session`, the first
failure of a streak logs `bridge:no-computer { address, retryInMs }` at info, the rest at debug (a
stale token closed 4401 right after the open does not count as reached). After that it is the usual
`bridge:lost` at warn. The backoff is page mode's, but in device mode the streak and its backoff
start over only on a `session`, not when a socket opens: a hub that closes every link before its
session (4401 on each reconnect) cannot cycle the phone faster than the backoff.

**Remembered links.** `localStorage["moku-editor:link"]` holds `{ v: 1, last, links: { [address]:
{ device, token } } }`, at most four addresses. A store of another version or a broken text reads as
nothing remembered. A store that throws (storage off) keeps the links in memory for the page's life
(`bridge:storage-failed` at debug). The links stay after stop.

### Log shipping

Device mode only, only while open: the recorder's oldest unacknowledged run
(`recorder.unsentRun(linesPerBatch)`) goes out as `editor`/`perf.lines { log, from, lines }`, one
batch in flight. The lines are the recorder's JSON texts, spliced into the message as they are, so
the hub receives objects. Triggered after the link step, by `recorder:status`, by each heartbeat
tick and after an ack. Nothing goes out while the socket is congested.

- Every `editor`/`perf.ack { log, next, n }` is handed to `recorder.ack(log, next)`. An ack of the
  batch in flight (same `log`, `n` its size) ends it and sends the next one. Any other ack is passed
  on too (the recorder treats a late one as a no-op), logged `bridge:late-ack` at debug.
- No ack within `callTimeoutMs`: shipping stalls on this link (`bridge:lines-unacked` warn, once).
  The next link resumes it.
- A failure drops the batch without an ack: its lines stay in the recorder and go out again after
  the next link. At-least-once on the bridge's side; the hub drops what it already has by index.

## Checkpoint

Bun HMR reloads the game page after a source save (D-23). Bun cannot be held:
`bun:beforeFullReload` only notifies. So the bridge keeps the game state across the reload:

1. On `import.meta.hot.on("bun:beforeFullReload")` it reads the clock and runs `game.bookmark`
   through its registry entry. The door runs at once, not a microtask later as through
   `channel.run`. When the run settles (microtasks, before the reload) it stores
   `{ v: 1, doc, at, frame, paused, bookmark }` as JSON in `sessionStorage["moku-editor:checkpoint"]`.
   `doc` is `performance.timeOrigin` of the page. `paused` is `registry.clock().held`, see
   [Which pause is kept](#which-pause-is-kept). Right after it starts the checkpoint it sends
   `bye` on the open socket: the hub ends the session with `bye`, and the tools read the reload
   as expected (U7, neutral "Reloading…" instead of a red lost).
2. On start, the bridge of the next page takes a checkpoint stored by another document, removes
   it, runs `game.restore { bookmark }`, then `game.pause` when its `paused` is true, and only then
   connects. Its first hello carries `manifest.restored = { bookmark, frame }`: `bookmark` is the
   JSON text of the restored bookmark, `frame` the frame of the old page. Later hellos do not.
3. Without a checkpoint it connects at once, as before.

### Which pause is kept

The checkpoint keeps only the pause the developer holds. `registry.clock()` answers two flags:
`paused` is true for any pause reason, `held` only while the reasons include `"devtools"`, the
reason `game.pause` pushes. The checkpoint stores `paused: clock.held`.

| Pause reasons at the reload | `clock.paused` | Stored `paused` | After the restore |
|---|---|---|---|
| none | `false` | `false` | The game runs. |
| `["background"]` (the tab is hidden) | `true` | `false` | No `game.pause`. The game pauses itself while the tab is hidden and runs when it is shown. |
| `["devtools"]` (`game.pause`, the editor's pause) | `true` | `true` | `game.pause` runs once. |
| `["background", "devtools"]` | `true` | `true` | `game.pause` runs once. |
| a game without `lifecycle.reasons` and a paused clock | `true` | `true` | `game.pause` runs once: `held` follows `paused` there. |

Why: `game.pause` after the restore pushes the reason `devtools`. Only `game.resume` ends it. A
hidden tab restored that way stayed paused after it was shown.

The stored shape and its version did not change: a checkpoint has no `held` and no `reasons`.

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

The bridge adds two commands to the registry in `onInit`. The first is `editor.reload`
(`reload.ts`, `reloadEntry`):

| Command | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.reload` | `"Reload the page"` | `{ restore: "boolean?" }` | `route` | `{ scheduled: true }` |

1. Checks the input. `restore` defaults to `true`. A non-boolean `restore` or an unknown field is
   refused with -32602, and nothing is scheduled.
2. With `restore`, it stores the checkpoint exactly as `bun:beforeFullReload` does
   (`takeCheckpoint`: clock, `game.bookmark`, `sessionStorage["moku-editor:checkpoint"]`) and waits
   for the store. Its `paused` is the devtools pause only, see
   [Which pause is kept](#which-pause-is-kept). A checkpoint that cannot be taken logs
   `bridge:checkpoint-failed`; the reload still happens. `restore: false` stores nothing.
3. It answers `{ scheduled: true }` with `state` = `registry.envelope()`.
4. On the next macrotask, after the answer went out, it sends `bye` on the open socket. On the
   macrotask after that it calls `location.reload()` (`reloadPage` of the reload seam; a no-op
   outside a browser page). `onStop` before then cancels it.
5. The bridge of the new document restores the checkpoint and sends `restored` in its first hello,
   as after Bun's full reload. The hub ends the old session with `bye` (U7: an expected reload).

The effect is `route`, not `raw`: the registry refuses `cheat` and `raw` for editor commands
(they bypass the game's journal). The reload taints nothing itself; the restore in the new
document runs `game.restore` through the game, which does.

```ts
await link.run("editor.reload"); // { value: { scheduled: true }, state: { path, frame, tainted } }
await link.run("editor.reload", { restore: false }); // a fresh start, no checkpoint
```

## editor.clock

The second command, added right after `editor.reload` (`clock.ts`, `clockEntry`):

| Command | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.clock` | `"Clock"` | `{}` | `read` | `{ frame, paused, held, reasons }` |

It answers `registry.clock()` as Json, with `state` = `registry.envelope()`. It runs no door and
changes nothing.

| Field | Meaning |
|---|---|
| `frame` | The frame of the game clock. |
| `paused` | True while the clock does not run, for any pause reason. The heartbeat sends the same flag. |
| `held` | True while the reasons include `"devtools"`: the developer paused the game. A reload restores this pause only. |
| `reasons` | `game.lifecycle.reasons()`, in push order. |

A game without `lifecycle.reasons` answers `reasons: []` and `held` equal to `paused`. The command
does not fail for it.

The heartbeat and `LinkStatus` keep `paused` only. A tool that must tell the two pauses apart runs
this command: workspace does before its own reload checkpoint. The MCP server lists it as the door
tool `editor_clock`.

```ts
// The game tab is hidden, the developer did not pause.
(await link.run("editor.clock")).value; // { frame: 1840, paused: true, held: false, reasons: ["background"] }
// After game.pause, in the same hidden tab.
(await link.run("editor.clock")).value; // { frame: 1840, paused: true, held: true, reasons: ["background", "devtools"] }
```

## API

`app.bridge` is `BridgeApi`: `{ status(): LinkStatus; session(): string | undefined }`. Both methods read state only.

| Member | Signature | Result |
|---|---|---|
| `status` | `status(): LinkStatus` | `{ kind: "connecting" }` before start and while connecting. `{ kind: "live" \| "paused", frame }` while open, from `channel.heartbeat()`. `{ kind: "lost", reason, lastFrame, retryInMs }` while lost (`retryInMs` is 0 when no retry is scheduled). `{ kind: "lost", reason: "stopped", lastFrame, retryInMs: 0 }` after stop. Never `silent` or `empty`: those are tools-side states. |
| `session` | `session(): string \| undefined` | The session id from the hub's `editor`/`session` notification after `hello`. `undefined` before it arrives and after the socket closes. |
| `link` | `link(): DeviceLink \| undefined` | Device mode: `{ mode: "none" \| "connecting" \| "adb" \| "lan", address, pairing?: { code }, editorEngine?, seenAt? }`, a fresh copy. `adb` is an open socket at a loopback address, `lan` at any other. `undefined` in page mode. |
| `connect` | `connect(address: string): void` | Switches to device mode at `address`, remembers it, closes the current socket (1000 `switch`) and dials now with the streak reset. The live address does nothing. A bad address throws a `TypeError` (`[moku-editor] bridge.connect needs host:port, got "<address>".`) and changes nothing. |

```ts
editor.bridge.status(); // { kind: "live", frame: 1840 }
editor.bridge.session(); // "s-7f3a"
```

Lost reasons:

| Reason | Retry |
|---|---|
| `no WebSocket in this runtime` | no |
| `no page URL for <hello>` (relative `hello` and no page URL) | no |
| `pairing refused` (device mode) | no |
| `no socket URL for <address>` (device mode, a `hello` that is not a URL) | no |
| `hello unreachable` | yes |
| `hello <status>` (404: no editor server, 403: not same-origin) | yes |
| `hello answered without ws and token` | yes |
| `hello answered a bad ws URL` | yes |
| `socket failed` | yes |
| `socket closed (<code>)`, plus `: <reason>` when the hub gave one (1008 `hello first`, 1001 `editor stopping`, 1012 `editor restarting`) | yes |
| `stopped` | no |

## Events

| Event | Direction | Payload | When |
|---|---|---|---|
| `bridge:status` | emitted | `{ status: LinkStatus; session?: string; link?: DeviceLink }` | At start (`connecting`), on every change of the status kind, on every session change, in device mode on every change of the link's mode, address, pairing code or computer engine, and while linked at most once per `SEEN_EMIT_MS` for `seenAt` alone. A frame change alone does not emit. `session` is left out when there is none; `link` in page mode. |
| `overlay:connect` | hooked (global) | `{ address }` | The overlay's Link tab asks for another computer. A bad address: warn `bridge:bad-address`, nothing else. Otherwise the same as `connect(address)`. |
| `recorder:status` | hooked (the recorder's, through `depends`) | `RecorderStatusEvent` | Ships the pending log lines; the bridge reads none of its numbers. |

`bridge:status` is a global agent event, declared in `AgentEvents` in `src/config.ts`. The bridge has
no `events` field. `onStop` emits nothing (teardown context).

The bridge hooks no events.

## Dependencies

| Plugin | Used |
|---|---|
| `registry` | `manifest()` for `hello` and the `manifest` request. `source(id)` for the `changes` kind of a watched source. `command(id)` for `game.bookmark`, `game.restore` and `game.pause` of the checkpoint, `clock()` for its frame and its pause flag (`held`) and for the value of `editor.clock`. `add(entry)` for `editor.reload` and `editor.clock` in `onInit`, `envelope()` for their `state`. `build()` for the engine and build id in `pair`. |
| `channel` | `read`, `watch`, `run` for every game request; a hub `run` passes the `via` of the hub's `from`: `tools`, `mcp`, or `bridge` for an older hub, and the MCP client's name with `mcp` only, so `registry:command` and the recorder name who ran it. `heartbeat()` and `onHeartbeat(fn)` for beats, the status, the backlog and frame sampling. |
| `recorder` | `unsentRun(max)` and `ack(log, next)` for log shipping (device mode). |

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
| `onInit` | `initBridge`: `checkConfig` (`hello` non-empty, `retryMs` and `callTimeoutMs` whole numbers of at least 100, `device` a `host:port` when set, `linesPerBatch` 1–1000), then `registry.add` of `editor.reload` and `editor.clock`, in that order. A duplicate id throws at `createApp`. |
| `onStart` | `startBridge`: reads the remembered links, decides the mode and the address, publishes `connecting`, listens to `channel.onHeartbeat`, to `visibilitychange`, to `pointerdown` on the window and to Bun's `bun:beforeFullReload`. In page mode a stored checkpoint is restored first; then it connects without awaiting. `app.start()` resolves even when no editor server answers. |
| `onStop` | `stopBridge`: phase `stopped`, clears the retry timer, every deadline and the ack deadline of a batch in flight, removes the listeners and a pending `editor.reload`, ends every subscription, clears the session. An open socket gets `bye` and close 1000. A socket that is not open yet is closed. A hello fetch still in flight opens nothing. |

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
| `bridge:connected` | info | Socket open. `{ url }` is the hello origin and path, or `ws://<address>{path}/ws` in device mode. |
| `bridge:no-computer` | info, then debug | Device mode, the first failure of a streak before the page ever linked. `{ address, retryInMs }`. |
| `bridge:paired` | info | The computer confirmed this phone. `{ address }`. |
| `bridge:unpaired` | info | A 4401 `unpaired` close: the credentials are dropped. `{ address }`. |
| `bridge:pairing-refused` | warn | The person refused the pairing. `{ address }`. |
| `bridge:bad-address` | warn | An `overlay:connect` or a build address `parseAddress` refuses. `{ address }`. |
| `bridge:lines-unacked` | warn | No `perf.ack` within `callTimeoutMs`: shipping stalls on this link. `{ address, log, from }`. |
| `bridge:storage-failed`, `bridge:late-ack`, `bridge:bad-ack`, `bridge:paired-ignored` | debug | The link store threw (`{ step }`), an ack that ends no batch (`{ log }`), a malformed ack, a `paired` on a socket that is not pairing. |
| `bridge:lost` | warn, then debug | First failure of a streak at warn, the rest at debug. A close 1012 `editor restarting` (the bin's Hot reload restart) opens the streak at info instead; the reconnect is the same. `{ reason, retryInMs }`. |
| `bridge:disabled` | error | A failure without retry. `{ reason }`. |
| `bridge:connect-crashed`, `bridge:request-crashed` | error | An unexpected throw in the connect loop or in a request. |
| `bridge:restored` | info | A checkpoint was restored at start. `{ frame }`. |
| `bridge:checkpoint-failed`, `bridge:restore-failed`, `bridge:pause-failed` | warn | The checkpoint could not be taken or stored, restored, or the game paused again. `{ message }`. |
| `bridge:late-result`, `bridge:sample-failed`, `bridge:refresh-failed`, `bridge:send-failed`, `bridge:socket-error`, `bridge:binary-ignored`, `bridge:bad-message`, `bridge:notification-ignored` | debug | Dropped or failed work that changes no state. |

## Integration notes

**Wire (with `hub`).**

| Direction | Message |
|---|---|
| agent to hub | `hello { manifest, caps }` (first; `manifest.restored` once after a checkpoint restore; `caps: ["run-from"]`, `HelloCaps` of `hub/protocol`), `heartbeat Heartbeat` (with `heap` in Chromium), `value { sub, value }`, `tap Tap`, `bye` (channel `game`), and the responses |
| hub to agent | requests `manifest`, `read { id, input? }`, `watch { sub, id, input? }`, `unwatch { sub }`, `run { id, input?, from?, client? }` (channel `game`; `from` and `client` only from a hub that read `run-from`). Notification `session { id, game, open, engine? }` (channel `editor`). |
| agent to hub, device mode | `pair PairParams` (first on a socket without credentials), `perf.lines PerfLinesParams` (channel `editor`) |
| hub to agent, device mode | `paired PairedParams`, `perf.ack PerfAckParams` (channel `editor`) |

The device-link types and `parseAddress` / `isLoopback` come from `../hub/protocol`
(runtime-free), never from the hub plugin.

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

## Who ran a command

The hub stamps every `run` it forwards to this bridge (its hello names `run-from`) with `from`:
`"page"` for the editor page, `"mcp"` for an agent's MCP bridge, and with `"mcp"` the MCP client's
name as `client` when the agent gave one. The bridge never trusts more than that:

| `from` | `via` (`registry:command`, the recorder) | `client` handed to the command |
|---|---|---|
| `"page"` | `tools` | none |
| `"mcp"` | `mcp` | the `client` string, cut to 64 characters; none when it is no string or empty |
| absent (an older hub) | `bridge` | none |
| anything else (a newer hub's origin) | `bridge`, and the command still runs (never -32602) | none |

`viaOf(from)` and `clientOf(from, client)` (pure, `dispatch/params.ts`) make the two columns. The
recorder's `editor.record` turns them into `startedBy`, e.g. "started by agent (Claude)".

## Command paths of the tools page

No method of its own: each is a registry command on the device, reached by the hub's `run` and
answered once within `callTimeoutMs`. The answer's `value` and a refusal's `code`, `message` and
`data` reach the hub unchanged (`toWireError`); the bridge adds no rule. After every `run` the
bridge re-reads every watched source at once, so the new rate (`editor.perf.second`) or the
recording (`editor.recorder`) shows one round trip after the answer, not at the next heartbeat.

| Command | Input | Answer | Refusal on the wire |
|---|---|---|---|
| `game.frameRate` | `{ fps: 60 }`, `{ fps: 120 }` (pin); `{}` (adaptive) | the engine's `FrameRate`, with `asked` and `heldBy: "panel" \| null` as the engine names them | a build without control: -32009 `dev_only`; a wrong `fps`: -32000 with the engine's first line |
| `game.debug` | `{ overdraw: boolean }` | `{ overdraw }` | a build without control: -32009 `dev_only`; an engine without the view: -32000 |
| `editor.perf.sections` | any of `gpu`, `passes`, `shaders`, `problems`, `memory`, `systems`, `nodes`, `longFrames` (booleans) | `PerfMonitorState` | -32009 `dev_only` or `read_only` (perf maps the engine's refusal) |
| `editor.record` | `{ on?, label?, mark? }` | `{ on, file, startedBy, marked }` | no monitor: -32000; empty input: -32602 |
| `editor.mark` | `{ label }` | `{ marked }` | none |

The manifest the bridge sends already says what the build runs (`build.profile`, each command's
`allowed`), so the tools page can grey a control before any press.

## Read paths of the tools page

| Source | How the tools page reads it |
|---|---|
| `editor.perf.frames { after }`, `editor.perf.events { after }` | `read` about once a second; each answer carries only what is new, and perf bounds its size |
| `editor.perf.passes`, `editor.perf.second`, `editor.recorder` | `watch` (`changes: "frame"`): re-read once per heartbeat and after every `run` |
| `editor.perf.detail { from, to }` | `read` once per selection, within the normal deadline |

Only `editor.series` and `editor.sheet` get the long-call extension of the deadline.

## Limits

- No cancel. A timed-out command keeps running in the game. Its result is dropped.
- The post-run re-read runs when the `run` settles. A `run` that never settles re-reads nothing.
- `frame` sources update once per channel heartbeat (`heartbeatMs`, default 1000), not per frame.
- A page reload the bridge does not see coming (the user's own reload, a crash) sends no `bye`. The
  tools page sees `game_reloaded`. Bun's full reload and `editor.reload` send `bye` first (U7).
- A hidden tab under Chrome's intensive throttling beats about once a minute. Hub and link wait
  65 s before `silent` because the last beat said `paused: true`.
- `no WebSocket in this runtime` and `no page URL for <hello>` schedule no retry. The status stays `lost` with `retryInMs: 0`.
- Device mode: a credentialed socket runs the link step on open; when the hub closes a stale token
  with 4401 right after the open, `bridge:connected` and a short `live` come before the re-pair.
- The native shell's device model is read from `__MOKU_NATIVE__.model` (the field is open on the
  native side); without it the Android user agent's model is sent.
