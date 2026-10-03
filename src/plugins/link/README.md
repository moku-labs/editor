# link

> Complex plugin (tools core). The tools page's only connection to the world.

`link` reads the boot JSON (`ToolsBoot`) the server put into the tools page, opens one websocket
to the hub, keeps the list of game sessions, chooses one (embedded first, then newest), caches its
manifest and exposes the remote `EditorChannel` every panel reads through. It also carries the
files client and derives the link status (connecting, live, paused, silent, lost, empty). It
renders nothing.

## API

`app.link` is `LinkApi` = `EditorChannel` plus:

| Member | What it does |
|---|---|
| `read(id, input?)` | Reads a source of the chosen game. Rejects -32003 `no_session` (not retryable) when no game is connected. |
| `watch(id, input, onValue)` | Watches a source. Accepted in every state, also while disconnected. Sent again after every reconnect or session change, with a new numeric wire sub. Returns an unsubscribe. |
| `run(id, input?)` | Runs a command. Resolves a checked `RunResult`. `editor.series` waits 10 s + `durationMs` (capped +60 s). |
| `status()` | The current `LinkStatus`. |
| `manifest()` / `onManifest(fn)` | The cached manifest of the chosen session, and a listener (called at once when one exists, `undefined` when the session is lost). |
| `sessions()` / `session()` | The last session list from the hub (empty while disconnected) and the chosen id. |
| `choose(session)` | Makes a session the sticky choice and attaches it. Rejects -32003 `choose_session` for an id that is not open. |
| `retry()` | "Retry now": reconnects, re-picks a session or re-reads the boot tag. No-op unless the status is `lost`. |
| `boot()` | The `ToolsBoot` of the page, `undefined` without a valid tag. Never log its token. |
| `files` | `list`, `read`, `write`, `writeBinary`, `readBinary` on the files channel. No session needed. |

```ts
const graph = await app.link.read("game.graph");
const stop = app.link.watch("game.history", { last: 20 }, history => draw(history));
const ran = await app.link.run("game.step", { frames: 1 });
await app.link.files.write(".moku/notes/2026-09-24-first-top-item.md", text);
app.link.retry();
stop();
```

Every error link makes is a wire error whose message starts with `[moku-editor]`. A socket close
and `app.stop()` reject pending calls with -32002 `link_closed` (retryable).

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `retryMs` | `1000` | Base delay of the backoff: `min(retryMs × 2^n, 8000)`. |
| `boot` | `"#moku-editor-boot"` | Selector of the JSON script tag `pages` injects. |

## Events

Emits the global tools event `link:status` (`{ status, session? }`, declared in `src/config.ts`) on
every change of kind, on a new heartbeat frame and on a new `retryInMs`. Hooks nothing.

| Status | When |
|---|---|
| `connecting` | Socket opening, or a session attached and no heartbeat yet. |
| `live` / `paused` | The chosen session beats (`paused` from the heartbeat flag). |
| `silent` | No heartbeat for 6 s, or 65 s when the last one said `paused: true`. |
| `lost` | Socket closed (`socket_closed`), chosen session closed (its reason), or no boot tag (`no_boot`). |
| `empty` | Connected, no game session (or 10 s after a lost session with none back). |

## Lifecycle

- `onStart`: starts the 1 s silence check, reads the boot tag, opens the socket. Does not wait for
  the socket.
- `onStop`: clears every timer, rejects pending calls with `link_closed`, closes the socket with
  1000 and forgets watches and manifest listeners.

Outside a browser (a Bun process) the socket sends an `Origin` header equal to the boot page
origin; in a browser the URL is the only constructor argument.
