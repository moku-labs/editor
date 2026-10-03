# capture

> Standard plugin (agent core, opt-in) — Adds editor commands to the registry so the tools page (and later MCP) can take pictures of the running game: `editor.capture` (one screenshot), `editor.series` (a timed series of screenshots, best effort, one call — never split into chunks, R1) and `editor.seriesStop` (ends a running series early, R2).

Capture is not in the agent's default plugins. A game's dev entry adds it next to the bridge:

```ts
import { bridgePlugin, capturePlugin, createApp } from "@moku-labs/editor/agent";

const editor = createApp({
  plugins: __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [],
  pluginConfigs: { registry: { game: app, modules: [] } }
});
```

Every shot runs the engine's door command `game.capture`: a PNG data URL of the whole canvas, taken at the end of the next drawn frame (at once while the clock is paused). The door answers no picture while the renderer is inert, headless or in a production build.

**No auto-capture.** The plugin has no hooks, no `onStart` and no timer outside a running series. A picture exists only because a caller ran one of its commands. The plugin writes no files: the tools page saves what it receives.

## API

No app api. The surface is the registry catalogue, reached in process through `channel.run` and remotely through the bridge → hub → `link.run`.

| Command | Input | Effect | Value |
|---|---|---|---|
| `editor.capture` | `{}` | `read` | `{ image, frame, device }` |
| `editor.series` | `{ durationMs: "number", intervalMs: "number" }` | `read` | `{ shots: { image, frame, atMs }[], device }` |
| `editor.seriesStop` | `{}` | `read` | `{ stopped: boolean }` |

- `frame` is the frame of the envelope `game.capture` returned: the real frame of the shot, best effort (a GPU read-back that crossed a frame boundary shows the frame before).
- `device` is the game page viewport in CSS pixels: `{ w, h, orientation }`. Headless it is `{ w: 0, h: 0, orientation: "portrait" }`.
- `editor.series` plans `max(1, floor(durationMs / intervalMs))` shots, shot k due at `k × intervalMs`. Shots run one after the other. A late shot is taken late, never dropped for lateness. Shots that would start after `durationMs` are dropped. A shot that fails is skipped. Each shot carries its real `atMs` and frame.
- `editor.seriesStop` ends the running series at once; the pending `editor.series` call resolves with the shots so far. Its `state` is `registry.envelope()`.
- Only one series runs at a time.

```ts
const shot = await link.run("editor.capture");
shot.value; // { image: "data:image/png;base64,iVBOR…", frame: 1841, device: { w: 393, h: 852, orientation: "portrait" } }

const series = await link.run("editor.series", { durationMs: 2000, intervalMs: 100 });
series.value.shots.length; // 20 (fewer when shots ran late)

await link.run("editor.seriesStop"); // { value: { stopped: false }, state: { path, frame, tainted } }
```

### Errors

Every message starts with `[moku-editor] `.

| Code | When |
|---|---|
| -32602 | Unknown input field; `durationMs` not positive or above `maxDurationMs`; `intervalMs` below `minIntervalMs` (`data.field` names the field). |
| -32601 | `game.capture` is not in the registry. |
| -32000 | The door gave no picture; a series took no picture; a series is already recording; the door itself failed. |

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `maxDurationMs` | `20000` | Longest series accepted, in ms. |
| `minIntervalMs` | `16` | Shortest interval accepted, in ms. |

A plan above 200 shots logs `capture:series-large` and still runs. Skipped shots are logged once per series as `capture:shots-skipped`.

## Events

None. The plugin declares no events, emits none and hooks none.

## Lifecycle

- `onInit` adds the three commands to the registry (`depends: [registryPlugin]`).
- `onStop` ends a running series: the pending call resolves with the shots so far, and no timer outlives the app.
