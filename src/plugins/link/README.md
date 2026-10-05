# link

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools page's only connection to the world.

`link` reads the boot JSON (`ToolsBoot`) that the server put into the tools page. It opens one
websocket to the hub and keeps the list of game sessions. It chooses one session: the sticky
choice first, then this page's own game frame, then the newest embedded one, then the newest.
The game frame of another tools tab is attached only through `choose()`. It caches that session's manifest
and exposes the remote `EditorChannel` that every panel reads through. It also carries the files
client and derives the link status. As the editor page (`role: "page"`), it publishes the editor
selection to the hub and answers the `editor.select` requests the hub relays (D-33). It renders
nothing.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `retryMs` | `number` | `1000` | Base delay of the reconnect backoff: `min(retryMs × 2^n, 8000)`. |
| `boot` | `string` | `"#moku-editor-boot"` | CSS selector of the JSON script tag `pages` injects. |
| `role` | `"page" \| "tools"` | `"page"` | `"page"`: the editor page. The upgrade URL gets `&role=page`, so the hub takes its `selection` and relays `editor.select` to it. `"tools"`: a plain tools client, no role sent. A headless e2e client passes `"tools"`. |

Fixed constants in `types.ts` (not config):

| Constant | Value | Meaning |
|---|---|---|
| `SILENT_AFTER_MS` | `6000` | No heartbeat for this long → `silent`. |
| `SILENT_AFTER_PAUSED_MS` | `65_000` | Used instead when the last heartbeat said `paused: true`. |
| `SILENCE_CHECK_MS` | `1000` | Period of the silence check. |
| `MAX_RETRY_MS` | `8000` | Cap of the reconnect backoff. |
| `EMPTY_AFTER_LOST_MS` | `10_000` | A lost session turns into `empty` when no session came back by then. |
| `CALL_TIMEOUT_MS` | `10_000` | Local deadline of every request. |
| `LONG_CALL_CAP_MS` | `60_000` | Cap of the long-call extension: `durationMs` of `editor.series`, `frames × everyMs` of `editor.sheet`. |
| `HOT_RELOAD_CONFIRM_MS` | `10_000` | How long `setHotReload` waits for the reconnect after its POST failed on the network (A1). |

## API

`app.link` is `LinkApi` = `EditorChannel` plus sessions, manifest, boot, taps, the page heap, hot
reload, the editor selection, the select handler and files.

| Member | Signature | What it does |
|---|---|---|
| `read` | `(id, input?) => Promise<Json>` | Reads a source of the chosen game. Rejects -32003 `no_session` (not retryable) at once when no game is connected. |
| `watch` | `(id, input, onValue) => () => void` | Watches a source. Accepted in every state, also while disconnected. Sent again after every reconnect or session change, with a new numeric wire sub. Returns the unsubscribe. |
| `run` | `(id, input?) => Promise<RunResult>` | Runs a command and checks the result shape. `editor.series` waits 10 s + `durationMs`, `editor.sheet` 10 s + `frames × everyMs` (both capped at +60 s). |
| `status` | `() => LinkStatus` | A copy of the current status. |
| `manifest` | `() => Manifest \| undefined` | The cached manifest of the chosen session. |
| `onManifest` | `(fn) => () => void` | Called at once when a manifest exists, then on every attach, and with `undefined` when the session is lost. |
| `sessions` | `() => readonly SessionInfo[]` | A copy of the last session list from the hub. Empty while disconnected. |
| `session` | `() => string \| undefined` | The chosen session id. |
| `choose` | `(session) => Promise<Manifest>` | Makes a session the sticky choice and attaches it. Rejects -32003 `choose_session` for an id that is not open. |
| `retry` | `() => void` | "Retry now": reconnects, re-picks a session or re-reads the boot tag. No-op unless the status is `lost`. |
| `boot` | `() => ToolsBoot \| undefined` | The boot data. `undefined` without a valid tag. Never log its token. |
| `frameUrl` | `(url) => string` | The game URL tagged with this page's frame id: the `__editorFrame` query parameter, one random id per tools page. workspace loads its game frame from it. |
| `isOtherTab` | `(page) => boolean` | True when a page URL carries another tools page's frame id. A page without one is not another tab's. |
| `onTap` | `(listener: (tap: Tap) => void) => () => void` | Called with every `tap { x, y, at }` of the chosen session: a `pointerdown` on the game page in page CSS px, `at` = the page's `performance.now()`. The bridge sends at most one per 50 ms. Taps of other sessions and malformed taps are dropped. Every listener gets the same frozen tap. A throwing listener is logged as `link:tap-listener-failed` and the others still run. The same function added twice is two subscriptions. Returns an idempotent unsubscribe. |
| `heap` | `() => { usedMb, limitMb } \| undefined` | A copy of the heap from the last heartbeat of the chosen session, in MB. `undefined` until the page reports one (only Chromium does), when its last beat had none, and after every attach or session loss. |
| `hotReload` | `() => HotReload \| undefined` | A copy of `{ hmr, owner }` from the hub's `editor.hotReload` notification (R6). `undefined` until the hub sent one. Kept across reconnects. |
| `onHotReload` | `(listener: (state: HotReload) => void) => () => void` | Called at once when the state is known, then on each change (the same state again is no change). Each listener gets the same frozen state. A throwing listener is logged as `link:hot-reload-listener-failed`. Returns an idempotent unsubscribe. |
| `setHotReload` | `(on: boolean) => Promise<boolean>` | `POST {path}/hmr` on the page origin (the boot socket's http origin outside a page) with `{ hmr }` and `Authorization: Bearer <boot.token>`. Takes the state the server answers. True when the bin owns the server and its HMR now equals `on`: the bin restarts its server for a change (D-32). False for a game's own server (`owner: "server"`), 401 or no boot. A network failure (the restart cut the answer off) is the warn `link:hot-reload-failed`; the call then waits up to 10 s for a `hotReload` state delivered on a new socket (the reconnect) and answers whether its `hmr` equals `on` (A1). A state the old socket delivered does not count. No reconnect in time, or `app.stop()`, answers false. Never rejects. |
| `selection` | `() => SelectionInfo \| undefined` | A fresh copy of the selection from the hub's last `editor.selection` notification: this page's own publish echoed back, or another editor page tab's. `undefined` until the hub sent one, and when nothing is selected. A malformed one is the warn `link:bad-selection` and keeps the last value. |
| `notify` | `(method: "selection", params: SelectionInfo \| null) => void` | Sends the editor-channel notification `selection` to the hub through `toWireValue`. `null` (nothing selected) goes out without params: the wire refuses null params. Dropped while the socket is closed. The last value, `null` included, is sent again each time a socket opens. The hub takes it only from a `role: "page"` link. A failed send is the warn `link:notify-failed`. A no-op after stop. |
| `handle` | `(method: "select", handler: (params: SelectParams) => Promise<SelectionInfo>) => () => void` | Handles the editor-channel request `select` the hub relays to this page (MCP `moku_select`). The params are checked with `parseSelectParams`; missing params are `{}`. The handler's result goes back through `toWireValue` with the hub's id. A thrown error goes back through `toWireError` and is logged as `link:request-failed`: at debug for invalid input (-32602, such as an unknown key; the caller gets the error), at warn otherwise. A later handler replaces an earlier one. Returns an idempotent remover that removes only its own handler. |
| `files` | `FilesClient` | `list(dir)`, `read(path)`, `write(path, text, version?)`, `writeBinary(path, dataUrl)`, `readBinary(path)`. No session needed. |

```ts
const graph = await app.link.read("game.graph");
const stop = app.link.watch("game.history", { last: 20 }, history => draw(history));
const ran = await app.link.run("game.step", { frames: 1 }); // ran.state.frame === 1841
app.link.status(); // { kind: "live", frame: 1840 }
app.link.onManifest(m => palette.index(m?.commands ?? []));
await app.link.choose("s-7f3a");
app.link.boot()?.gameUrl; // "/"
app.link.frameUrl("http://127.0.0.1:3000/"); // "http://127.0.0.1:3000/?__editorFrame=3f9a1c2b7d4e"
const offTaps = app.link.onTap(tap => ripple(tap.x, tap.y)); // { x: 206, y: 640, at: 15234.5 }
app.link.heap(); // { usedMb: 12.8, limitMb: 4095.8 } in Chromium, undefined elsewhere
app.link.hotReload(); // { hmr: true, owner: "bin" } under the moku-editor bin
await app.link.setHotReload(false); // true: the bin restarted without HMR
app.link.notify("selection", info); // the hub keeps it; MCP moku_selection answers it
const offSelect = app.link.handle("select", params => selectByKey(params)); // MCP moku_select
app.link.selection()?.key; // "coins"
await app.link.files.write("docs/plan.md", text);
app.link.retry();
offTaps();
offSelect();
stop();
```

### Errors

Every error is a wire error built with `wireError`. Its message starts with `[moku-editor]`.

| Code | `data.reason` | Retryable | When |
|---|---|---|---|
| -32003 | `no_session` | no | `read` or `run` with no open socket or no chosen session. |
| -32003 | `choose_session` | no | `choose` with an id that is not open. |
| -32002 | `timeout` | yes | No answer before the deadline. |
| -32002 | `link_closed` | yes | Socket not open, socket closed, or `app.stop()`. |
| any | from the hub | from the hub | The hub's error, rebuilt with its code and data. |

Answers this page sends to the hub for an editor-channel request:

| Code | `data.reason` | When |
|---|---|---|
| -32601 | none | No handler for the method (`select` without `handle`, or any other editor method). |
| -32602 | `invalid_input` | The params are not SelectParams. The handler is not called. |
| any | the handler's | The handler threw a wire error. A plain `Error` is -32000 `command_failed`. |

## Events

`link` declares no plugin events. It emits one global tools event, declared in `src/config.ts`.

| Event | Payload | When |
|---|---|---|
| `link:status` | `{ status: LinkStatus; session?: string }` | The status changed kind or any field (new heartbeat frame, new `retryInMs`), or the session changed with the same status. |

| Status | When |
|---|---|
| `connecting` | Socket open, or a session attached and no heartbeat yet. |
| `live` / `paused` | The chosen session beats. `paused` comes from the heartbeat flag. |
| `silent` | No heartbeat for 6 s, or 65 s when the last one said `paused: true`. |
| `lost` | Socket closed (`socket_closed`), chosen session closed (its reason), or no boot tag (`no_boot`). |
| `empty` | Connected, no game session. Also 10 s after a lost session when none came back. |

Hooks: none. Inputs are socket messages and timers.

## Dependencies

| Kind | What |
|---|---|
| `depends` | none. `link` is the first tools plugin. |
| Imports | `../registry/protocol` (runtime-free wire types and helpers). |
| Global events | emits `link:status`. |
| Runtime globals | `WebSocket`, `fetch`, `document`, timers. No npm runtime dependency. |

## Usage

From the consumer side:

```ts
import { createApp } from "@moku-labs/editor/tools";

const tools = createApp({ pluginConfigs: { link: { retryMs: 500 } } });
await tools.start(); // resolves with status "connecting", or lost "no_boot"
tools.link.watch("game.position", undefined, position => show(position));
```

From another tools plugin:

```ts
const link = ctx.require(linkPlugin);
const off = link.onManifest(manifest => recheck(manifest));
```

## Lifecycle

| Phase | Does |
|---|---|
| `onStart` | Starts the 1 s silence check, reads the boot tag, opens the socket. Does not wait for the socket. |
| `onStop` | Sets `stopped`, clears the retry and silence timers, rejects pending calls with `link_closed`, answers waiting `setHotReload` calls false, closes the socket with 1000, forgets watches, manifest, tap and hot reload listeners, the notified values and the request handlers. |

## Integration notes

- `workspace` requires `link` for `status`, `manifest`, `onManifest`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`, `frameUrl`, `isOtherTab`. The frame URL is `frameUrl(boot()?.gameUrl ?? "/")`.
- Two tools tabs on one hub: each embeds its own game. A session whose page carries this page's frame id wins. An embedded session with another page's frame id is never picked on its own, so a second tab does not take the first one over. An embedded page without a frame id is picked as before.
- `panels` watches every panel source through `link.watch` and re-checks sources on `onManifest`.
- `workspace` subscribes once to `onTap` for the tap ripple over the docked game frame. `renderView` reads `heap()` on each `game.render` change for the heap tile.
- Views use `link.files` (through `tools.files`) for captures, the layout file, file tabs and style edits.
- A switch of session sends `unwatch` for the old subs first. Wire subs are numbers that never repeat, so late values of an old sub are dropped.
- A failed manifest fetch of the current attach is retried later. A retryable failure (a timeout, a reloading game) logs `link:manifest-failed` at debug, every other at error.
- A source id missing from the new manifest is skipped with the warn `link:source-missing`. The watch record stays for a later session.
- A watch the session refuses with -32008 `not_installed` (the game does not have the source: the manifest lists it with `available: false`) logs only the debug line `link:source-unavailable` and is never sent to that session again. A new session gets it again. `readManifest` keeps `available: false` and `reason` on a source descriptor.
- `readManifest` keeps `restored { bookmark, frame }` (set by the bridge in the first hello after it restored its checkpoint across Bun's full reload, R6) and drops a malformed one; the manifest stays.
- Hot reload: the hub sends `editor.hotReload { hmr, owner }` after `sessions {list}` and on each change. A malformed one is the warn `link:bad-hot-reload`. workspace shows the Hot reload switch from `hotReload()`/`onHotReload`, calls `setHotReload` and confirms by `onHotReload`.
- Hot reload switch (D-32, A1): the bin answers the POST, then restarts its server. The hub closes the socket with 1012 `editor restarting` first; link logs `link:closed` at info, as every close, and reconnects after `retryMs`; the hub replays `hotReload` on open. That replay settles a `setHotReload` whose answer the restart cut off.
- Editor page (D-33): gameView publishes every selection change with `notify("selection", …)` and registers `handle("select", …)` for MCP. The hub keeps the last selection and sends it to every tools connection, this page included, so `selection()` follows it. An answer to a relayed request goes out only on the socket the request came on; after a reconnect it is dropped (`link:answer-dropped` debug): the hub failed that call with `page_closed` already.
- Requests on another channel than `editor` are still only logged (`link:unexpected-request` debug), without an answer.
- A socket that never opened refreshes the token through `${boot.path}/hello` before the next attempt.
- Outside a browser (Bun), the socket sends an `Origin` header equal to the boot page origin. In a browser the URL is the only constructor argument.
- The token is never logged. The connect log line carries `boot.ws` without its query.

## Limits

- Requests are not queued while disconnected. They reject at once. Only watch records are kept.
- `EditorChannel.watch` has no error path. A failed watch is logged as `link:watch-failed` (not for -32008 `not_installed`); panels shows the waiting text.
- A game reload mid-call rejects with the hub's -32001 `game_reloaded` (retryable).
- A throttled hidden game tab that is not paused can read `silent`.
