# link

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools page's only connection to the world.

`link` reads the boot JSON (`ToolsBoot`) that the server put into the tools page. It opens one
websocket to the hub and keeps the list of game sessions. It chooses one session: the sticky
choice first, then this page's own game frame, then the newest embedded one, then the newest.
The game frame of another tools tab is attached only through `choose()`. It caches that session's manifest
and exposes the remote `EditorChannel` that every panel reads through. It also carries the files
client and derives the link status. It renders nothing.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `retryMs` | `number` | `1000` | Base delay of the reconnect backoff: `min(retryMs × 2^n, 8000)`. |
| `boot` | `string` | `"#moku-editor-boot"` | CSS selector of the JSON script tag `pages` injects. |

Fixed constants in `types.ts` (not config):

| Constant | Value | Meaning |
|---|---|---|
| `SILENT_AFTER_MS` | `6000` | No heartbeat for this long → `silent`. |
| `SILENT_AFTER_PAUSED_MS` | `65_000` | Used instead when the last heartbeat said `paused: true`. |
| `SILENCE_CHECK_MS` | `1000` | Period of the silence check. |
| `MAX_RETRY_MS` | `8000` | Cap of the reconnect backoff. |
| `EMPTY_AFTER_LOST_MS` | `10_000` | A lost session turns into `empty` when no session came back by then. |
| `CALL_TIMEOUT_MS` | `10_000` | Local deadline of every request. |
| `LONG_CALL_CAP_MS` | `60_000` | Cap of the `durationMs` extension for `editor.series`. |

## API

`app.link` is `LinkApi` = `EditorChannel` plus sessions, manifest, boot, taps, the page heap, hot
reload and files.

| Member | Signature | What it does |
|---|---|---|
| `read` | `(id, input?) => Promise<Json>` | Reads a source of the chosen game. Rejects -32003 `no_session` (not retryable) at once when no game is connected. |
| `watch` | `(id, input, onValue) => () => void` | Watches a source. Accepted in every state, also while disconnected. Sent again after every reconnect or session change, with a new numeric wire sub. Returns the unsubscribe. |
| `run` | `(id, input?) => Promise<RunResult>` | Runs a command and checks the result shape. `editor.series` waits 10 s + `durationMs` (capped at +60 s). |
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
| `setHotReload` | `(on: boolean) => Promise<boolean>` | `POST {path}/hmr` on the page origin (the boot socket's http origin outside a page) with `{ hmr }` and `Authorization: Bearer <boot.token>`. Takes the state the server answers. True when the bin owns the server and its HMR already equals `on`; false otherwise: a change (the server answers 200 with the unchanged state, Bun cannot switch HMR live), a game's own server (`owner: "server"`), 401, no boot, or a network failure (`link:hot-reload-failed` warn). Never rejects. |
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
await app.link.setHotReload(false); // false: restart the bin to change hot reload
await app.link.files.write("docs/plan.md", text);
app.link.retry();
offTaps();
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
| `onStop` | Sets `stopped`, clears the retry and silence timers, rejects pending calls with `link_closed`, closes the socket with 1000, forgets watches, manifest, tap and hot reload listeners. |

## Integration notes

- `workspace` requires `link` for `status`, `manifest`, `onManifest`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`, `frameUrl`, `isOtherTab`. The frame URL is `frameUrl(boot()?.gameUrl ?? "/")`.
- Two tools tabs on one hub: each embeds its own game. A session whose page carries this page's frame id wins. An embedded session with another page's frame id is never picked on its own, so a second tab does not take the first one over. An embedded page without a frame id is picked as before.
- `panels` watches every panel source through `link.watch` and re-checks sources on `onManifest`.
- `workspace` subscribes once to `onTap` for the tap ripple over the docked game frame. `renderView` reads `heap()` on each `game.render` change for the heap tile.
- Views use `link.files` (through `tools.files`) for captures, the layout file, file tabs and style edits.
- A switch of session sends `unwatch` for the old subs first. Wire subs are numbers that never repeat, so late values of an old sub are dropped.
- A source id missing from the new manifest is skipped with the warn `link:source-missing`. The watch record stays for a later session.
- A watch the session refuses with -32008 `not_installed` (the game does not have the source: the manifest lists it with `available: false`) logs only the debug line `link:source-unavailable` and is never sent to that session again. A new session gets it again. `readManifest` keeps `available: false` and `reason` on a source descriptor.
- `readManifest` keeps `restored { bookmark, frame }` (set by the bridge in the first hello after it restored its checkpoint across Bun's full reload, R6) and drops a malformed one; the manifest stays.
- Hot reload: the hub sends `editor.hotReload { hmr, owner }` after `sessions {list}` and on each change. A malformed one is the warn `link:bad-hot-reload`. workspace (wave 2a) shows the Hot reload switch from `hotReload()`/`onHotReload` and calls `setHotReload`.
- A socket that never opened refreshes the token through `${boot.path}/hello` before the next attempt.
- Outside a browser (Bun), the socket sends an `Origin` header equal to the boot page origin. In a browser the URL is the only constructor argument.
- The token is never logged. The connect log line carries `boot.ws` without its query.

## Limits

- Requests are not queued while disconnected. They reject at once. Only watch records are kept.
- `EditorChannel.watch` has no error path. A failed watch is logged as `link:watch-failed` (not for -32008 `not_installed`); panels shows the waiting text.
- A game reload mid-call rejects with the hub's -32001 `game_reloaded` (retryable).
- A throttled hidden game tab that is not paused can read `silent`.
