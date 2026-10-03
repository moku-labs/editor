# channel

> Standard plugin (agent core) — The in-process `EditorChannel` of the game page.

The in-game overlay and the bridge talk to the game through the channel, never to the registry
entries directly. It solves three timing problems of the game's doors:

1. **Immediate read on watch.** A door `watch` is a frame callback, so a paused game never calls it.
   `watch` reads the source at once and delivers that value before it returns, then follows the door.
2. **Run off the frame loop.** `time.step()` throws inside a frame callback. `run` always dispatches
   in a microtask (`queueMicrotask`), so a caller inside a frame still gets a clean run.
3. **Heartbeat on `setInterval`.** A `{ frame, paused, at }` beat every `heartbeatMs`, driven by a
   timer, so a paused game still beats. `paused` comes from `registry.clock()`.

## API

`app.channel` / `ctx.require(channelPlugin)` is `EditorChannel & { heartbeat; onHeartbeat }`.

| Method | Result |
|---|---|
| `read(id, input?)` | `Promise<Json>`. Reads now. Rejects -32601 for an unknown id, or with the entry's error. Never throws synchronously. |
| `watch(id, input, onValue)` | `() => void`. Calls `onValue` with the current value before it returns, then on every door change. The door's first-frame repeat of the same value is dropped. Unknown id or invalid input throws synchronously. The stop is idempotent. |
| `run(id, input?)` | `Promise<RunResult>`. Runs in a microtask. Rejects -32601 for an unknown id, or with the command's error. |
| `status()` | `{ kind: "live" \| "paused", frame }` from `registry.clock()`. |
| `heartbeat()` | A fresh frozen `{ frame, paused, at }`. |
| `onHeartbeat(fn)` | Calls `fn` on every interval tick, in subscription order. Returns an idempotent remover. A throwing listener is logged as `channel:heartbeat-listener-failed`; the others still run. |

```ts
const stop = editor.channel.watch("game.position", undefined, position => show(position)); // show() ran once
await editor.channel.run("game.step", { frames: 1 });
const off = editor.channel.onHeartbeat(beat => send("heartbeat", beat));
stop();
off();
```

## Configuration

| Option | Default | Rule |
|---|---|---|
| `heartbeatMs` | `1000` | Whole number, at least 100. Checked in `onInit`. |

```ts
createApp({ pluginConfigs: { channel: { heartbeatMs: 500 } } });
```

## Lifecycle

- **onInit:** validates `heartbeatMs`.
- **onStart:** starts the heartbeat interval (unref'd where the runtime allows). No beat at start.
- **onStop:** clears the interval, closes every open watch, clears the listeners.

## Dependencies

`registry`: `source(id)`, `command(id)`, `clock()`.

## Events

None. The heartbeat is a callback api (`onHeartbeat`), not an event.
