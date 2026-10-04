# channel

> Standard plugin (agent core). The in-process `EditorChannel` of the game page.

The in-game overlay and the bridge talk to the game through the channel. They never call the
registry entries directly. The channel solves three timing problems of the game's doors:

1. **Immediate read on watch.** A door `watch` is a frame callback, so a paused game never calls it.
   `watch` reads the source at once and delivers that value before it returns. Then it follows the door.
2. **Run off the frame loop.** `time.step()` throws inside a frame callback. `run` always dispatches
   in a microtask (`queueMicrotask`), so a caller inside a frame still gets a clean run.
3. **Heartbeat on `setInterval`.** A `{ frame, paused, at }` beat every `heartbeatMs`, driven by a
   timer, so a paused game still beats. `frame` and `paused` come from `registry.clock()`. In
   Chromium the beat also carries `heap { usedMb, limitMb }`: `performance.memory`
   `usedJSHeapSize` and `jsHeapSizeLimit` divided by 2^20, rounded to 0.1. Where the runtime has no
   `performance.memory` (Firefox, Safari, Bun) `heap` is absent.

The channel is a default plugin of `@moku-labs/editor/agent`: `[registryPlugin, channelPlugin, overlayPlugin]`.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `heartbeatMs` | `number` | `1000` | Milliseconds between two beats. A whole number, at least 100. Checked in `onInit`, so a bad value throws at `createApp`. |

A bad value throws:

```
[moku-editor] channel.heartbeatMs must be a whole number of at least 100.
  Pass pluginConfigs.channel.heartbeatMs, for example 1000.
```

## API

`app.channel` and `ctx.require(channelPlugin)` are `ChannelApi`:
`EditorChannel & { heartbeat(); onHeartbeat(fn) }`. `EditorChannel`, `Heartbeat`, `Json`,
`RunResult` and `LinkStatus` come from `../registry/protocol`.

| Member | Signature | Behaviour |
|---|---|---|
| `read` | `(id: string, input?: Json) => Promise<Json>` | Reads the source now. A missing input is passed as `null`. Rejects -32601 `[moku-editor] <id>: unknown source` with `data: { reason: "unknown_id", retryable: false, id }`. Rejects with the entry's error unchanged. Never throws synchronously. |
| `watch` | `(id: string, input: Json \| undefined, onValue: (value: Json) => void) => () => void` | Calls `onValue` with the current value before it returns, then on every door delivery. The first door delivery is dropped when its JSON text equals the first read. Later equal deliveries are passed on. An unknown id, an invalid input or an `onValue` throw on the first value throws synchronously and opens no door watch. Returns an idempotent stop. |
| `run` | `(id: string, input?: Json) => Promise<RunResult>` | Runs the command in a microtask. Rejects -32601 `[moku-editor] <id>: unknown command`, or with the command's error. A synchronous throw of the entry also rejects. No timeout. |
| `status` | `() => LinkStatus` | `{ kind: "paused", frame }` when `registry.clock()` says paused, else `{ kind: "live", frame }`. Never a wire state. |
| `heartbeat` | `() => Heartbeat` | A fresh frozen `{ frame, paused, at }`, plus a frozen `heap { usedMb, limitMb }` where `performance.memory` has finite numbers. `at` is `Date.now()`. Works before `start`. |
| `onHeartbeat` | `(fn: HeartbeatListener) => () => void` | Calls `fn` on every interval tick with the same frozen beat, in subscription order. Returns an idempotent remover. The same `fn` added twice is two subscriptions. A throwing listener is logged as `channel:heartbeat-listener-failed` with `{ message }`. The other listeners still run. |

```ts
await channel.read("game.history", { last: 1 }); // [{ path: "home", outcome: "play", … }]

const stop = channel.watch("game.position", undefined, p => show(p)); // show() runs once now
stop();

(await channel.run("game.step", { frames: 1 })).state; // { path: "board/awaitIntent", frame: 1841, tainted: false }

channel.status(); // { kind: "live", frame: 1840 }
channel.heartbeat(); // { frame: 1840, paused: true, at: 1790000000000 }
// in Chromium: { frame: 1840, paused: true, at: 1790000000000, heap: { usedMb: 12.8, limitMb: 4095.8 } }

const off = channel.onHeartbeat(beat => send("heartbeat", beat));
off();
```

### Watch while the game is paused

| Situation | Behaviour |
|---|---|
| Game paused | The first value still arrives at once. Nothing more until frames run again. `game.step` runs frames while paused. |
| Headless game in Bun | Only the first value until the test calls `app.time.step()`. |
| `stop()` inside `onValue` | Allowed. The door watch is closed. |

## Lifecycle

| Phase | What happens |
|---|---|
| `onInit` | `checkConfig` validates `heartbeatMs`. |
| `onStart` | `startHeartbeat` starts the interval. It is unref'd where the timer has `unref` (Bun, Node). No beat is sent at start. |
| `onStop` | `stopChannel` clears the interval, calls the stop of every open watch, clears the listeners. |

## Events

None emitted, none hooked. The heartbeat is a callback api (`onHeartbeat`), not an event.

| Log event | Level | Payload | When |
|---|---|---|---|
| `channel:heartbeat-listener-failed` | `warn` | `{ message }` | An `onHeartbeat` listener threw during a tick. |

## Dependencies

| Kind | Value |
|---|---|
| `depends` | `[registryPlugin]` |
| Registry members used | `source(id)` for `read` and `watch`, `command(id)` for `run`, `clock()` for `status` and the heartbeat (`ChannelRegistry`) |
| Global events | None |
| Package imports | None from `@moku-labs/game`. The game is reached only through the registry entries. |

## Usage

From the consumer side:

```ts
import { createApp } from "@moku-labs/editor/agent";

const editor = createApp({
  pluginConfigs: {
    registry: { game: app, modules: [mergeDev] },
    channel: { heartbeatMs: 500 }
  }
});
await editor.start();
const stop = editor.channel.watch("game.position", undefined, position => show(position));
await editor.channel.run("game.step", { frames: 1 });
```

From another agent plugin:

```ts
export const myPlugin = createAgentPlugin("my", {
  depends: [registryPlugin, channelPlugin],
  api: ctx => {
    const channel = ctx.require(channelPlugin);
    return { step: () => channel.run("game.step", { frames: 1 }) };
  }
});
```

## Integration notes

| Plugin | Uses | How |
|---|---|---|
| `bridge` | `read`, `watch`, `run`, `heartbeat`, `onHeartbeat` | `depends: [registryPlugin, channelPlugin]`. Answers wire `read` and `run` through the channel. Follows `edge` and `commit` sources with `watch`. Re-reads `frame` sources on each beat instead of watching them. Pushes each beat to the hub, flushes its backlog on `onHeartbeat`, and builds `status()` from `heartbeat()`. Sends one extra beat on `visibilitychange`. |
| `overlay` | `watch`, `run` | `depends: [registryPlugin, channelPlugin]`. Watches `game.render` for the scene and runs cheat commands. |
| `capture` | none | Its commands are dispatched through `channel.run` in process, or through the bridge. Capture itself does not require the channel. |

## Limits and follow-ups

- The interval is a browser timer. Background tabs throttle it to 1 s or more, and Chrome to about one
  minute after a long hide. Hub and link wait 65 s instead of 6 s before `silent` when the last beat
  said `paused: true`.
- Microtasks are not throttled, so `run` still works in a hidden tab.
- `run` has no timeout. The bridge adds one for wire calls.
- The first-frame dedupe compares JSON text and drops only the first door delivery.
- `run` assumes the game's frame tick is synchronous. The integration test "runs game.step from
  inside a frame callback" checks it.
