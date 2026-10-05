# capture

> Standard plugin (agent core, opt-in). Adds four editor commands to the registry so the tools page and the MCP bridge can take pictures of the running game: `editor.capture` (one screenshot, optionally shrunk to `maxWidth`), `editor.series` (a timed series in one call, never split into chunks, R1), `editor.seriesStop` (ends a running series early, R2) and `editor.sheet` (a contact sheet from the game, shrunk to `maxWidth`).

Capture is not in the agent's default plugins (registry, channel, overlay). A game's dev entry adds it next to the bridge.

Every shot runs the engine's door command `game.capture`. The door answers a picture of the whole canvas, taken at the end of the next drawn frame, or at once while the clock is paused. It answers no picture while the renderer is inert, headless or in a production build.

The picture comes in two shapes, and both are taken:

| Game | `game.capture` answers | Picture |
|---|---|---|
| 0.1.x | `"data:image/png;base64,…"` | The string itself. |
| 0.4.x | `{ png: "data:image/png;base64,…", legend? }` | The string `png`. |

Anything else is no picture (-32000).

**No auto-capture.** The plugin has no hooks, no `onStart` and no timer outside a running series. A picture exists only because a caller ran one of its commands. The plugin writes no files: the tools page saves what it receives.

## Configuration

Set through `pluginConfigs.capture`. Defaults from `index.ts`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxDurationMs` | `number` | `20000` | Longest series accepted, in ms. More is refused with -32602, field `durationMs`. |
| `minIntervalMs` | `number` | `16` | Shortest interval accepted, in ms. Less is refused with -32602, field `intervalMs`. |

Constants in `types.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `WARN_SHOTS` | `200` | A plan above this many shots logs `capture:series-large` and still runs. |
| `CAPTURE_ID` | `"game.capture"` | The door command every shot runs. |
| `SHOT_ID` | `"editor.capture"` | The one-shot command, named in its errors. |
| `SHEET_ID` | `"editor.sheet"` | The contact-sheet command, named in its errors. |
| `MIN_SHEET_FRAMES`, `MAX_SHEET_FRAMES` | `2`, `12` | Pictures per contact sheet (the game's limit). |
| `MIN_SHEET_EVERY_MS`, `MAX_SHEET_EVERY_MS` | `1`, `5000` | Game time between two pictures of a contact sheet, in ms (the game's limit). |
| `MIN_MAX_WIDTH` | `64` | Smallest `maxWidth` of `editor.capture` and `editor.sheet`, in pixels. |
| `MAX_MAX_WIDTH` | `4096` | Largest `maxWidth` of `editor.capture` and `editor.sheet`, in pixels. |

## API

No app api. The surface is the registry catalogue. In process it is reached through `channel.run`. Remotely it is reached through the bridge, the hub and `link.run`.

| Command | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.capture` | `"Screenshot"` | `{ maxWidth: "number?" }` | `read` | `Shot = { image, frame, device }` |
| `editor.series` | `"Record a series"` | `{ durationMs: "number", intervalMs: "number" }` | `read` | `SeriesValue = { shots: SeriesShot[], device }` |
| `editor.seriesStop` | `"Stop the series"` | `{}` | `read` | `{ stopped: boolean }` |
| `editor.sheet` | `"Contact sheet"` | `{ frames: "number", everyMs: "number", maxWidth: "number?" }` | `read` | `Sheet = { image, frame, device }` |

Value types (exported as the `Capture` namespace from `@moku-labs/editor/agent`):

```ts
type Device = { readonly w: number; readonly h: number; readonly orientation: "portrait" | "landscape" };
type Shot = { readonly image: string; readonly frame: number; readonly device: Device };
type Sheet = { readonly image: string; readonly frame: number; readonly device: Device };
type SeriesShot = { readonly image: string; readonly frame: number; readonly atMs: number };
type SeriesValue = { readonly shots: readonly SeriesShot[]; readonly device: Device };
```

### `editor.capture`

- Checks the input. Unknown fields are refused with -32602.
- `maxWidth` is optional: a whole number from 64 to 4096, else -32602 with field `maxWidth`. It is checked before the door runs.
- Runs `game.capture` once. `frame` is the frame of the envelope `game.capture` returned. It is the real frame of the shot, best effort: a GPU read-back that crossed a frame boundary shows the frame before.
- `state` is the state `game.capture` ran with.
- `device` is the game page viewport in CSS pixels. Landscape only when wider than high. Headless it is `{ w: 0, h: 0, orientation: "portrait" }`.

```ts
const shot = await link.run("editor.capture");
shot.value; // { image: "data:image/png;base64,iVBOR…", frame: 1841, device: { w: 393, h: 852, orientation: "portrait" } }
```

#### `maxWidth`

The MCP bridge sends it (`moku_screenshot`, default 1080), so a picture stays small enough for the agent.

- Absent: the picture is answered as the door gave it. Nothing is decoded.
- The picture is not wider than `maxWidth`: answered unchanged.
- The picture is wider: the page shrinks it to `maxWidth` pixels wide, aspect kept, height rounded (at least 1 px), and answers a PNG data URL.
- The page decodes with `createImageBitmap` and draws on an `OffscreenCanvas`, or on a `canvas` element where there is none (`canvas.ts`, `decodePicture`). The decoded bitmap is freed after every shot.
- A page that cannot do it (no `createImageBitmap`, no canvas, no 2d context, a picture that is not a base64 data URL) answers the full picture and logs `capture:downscale-failed` at warn with `{ message }`. The screenshot still works.
- `frame`, `device` and `state` do not change with `maxWidth`.

```ts
const small = await link.run("editor.capture", { maxWidth: 540 });
small.value.image; // a 540 × 960 PNG data URL for a 1080 × 1920 canvas
```

### `editor.series`

- Plans `max(1, floor(durationMs / intervalMs))` shots. Shot k is due at `k × intervalMs`.
- Shots run one after the other, never overlapping.
- A late shot is taken late, never dropped for lateness.
- Shots that would start at or after `durationMs` are dropped.
- A shot that fails is skipped. Skipped shots are logged once per series as `capture:shots-skipped`.
- Each shot carries its real `atMs` (rounded ms since the series start) and its real frame.
- `state` is the state of the last good shot.
- Only one series runs at a time.

```ts
const series = await link.run("editor.series", { durationMs: 2000, intervalMs: 100 });
series.value.shots.length; // 20 (fewer when shots ran late)
series.value.shots[0]; // { image: "data:image/png;base64,…", frame: 1777, atMs: 0 }
```

### `editor.sheet`

The MCP bridge runs it for `moku_series` with `maxWidth: 1080`. Needs game 0.4: `game.capture` must take `sheet`.

- Checks the input. Unknown fields are refused with -32602.
- `frames` is a whole number from 2 to 12, `everyMs` a number from 1 to 5000, else -32602 naming the field. `maxWidth` follows the `editor.capture` rule, named `editor.sheet` in the error. All checked before the door runs.
- Runs `game.capture { sheet: { frames, everyMs } }` once. The game takes `frames` pictures `everyMs` of game time apart and lays them out in `ceil(sqrt(frames))` columns. The picture follows the `pictureOf` rule: the data URL itself, or the string `png` of `{ png }`.
- Shrinks the sheet to `maxWidth` with the same page decoder as `editor.capture`. A page that cannot do it answers the full sheet and logs `capture:downscale-failed`.
- `frame` is the frame of the envelope `game.capture` returned: the frame after the last picture. `state` is that envelope. `device` as for `editor.capture`.
- No picture: -32000 with `data.id` `"editor.sheet"`. An error of the door (a game 0.1 without `sheet` refuses the field with -32602) passes through unchanged.
- It is a long call: bridge, hub and link wait `frames × everyMs` on top of the call deadline, capped at +60 s.

```ts
const sheet = await link.run("editor.sheet", { frames: 6, everyMs: 500, maxWidth: 1080 });
sheet.value; // { image: "data:image/png;base64,…", frame: 1872, device: { w: 393, h: 852, orientation: "portrait" } }
```

### `editor.seriesStop`

- Checks the empty input.
- Sets the stop flag, clears the wait timer and wakes the pending wait. The pending `editor.series` call resolves with the shots so far.
- Value `{ stopped: true }` when a series ran, `{ stopped: false }` when idle.
- It runs no door, so its `state` is `registry.envelope()`.

```ts
await link.run("editor.seriesStop"); // { value: { stopped: false }, state: { path, frame, tainted } }
```

### Errors

Every message starts with `[moku-editor] `.

| Code | `data.reason` | When |
|---|---|---|
| -32602 | `invalid_input` | Unknown input field. `maxWidth` not a whole number from 64 to 4096. `durationMs` not a positive finite number or above `maxDurationMs`. `intervalMs` not finite or below `minIntervalMs`. `frames` not a whole number from 2 to 12. `everyMs` not a number from 1 to 5000. `data.field` names the field. |
| -32601 | `unknown_id` | `game.capture` is not in the registry. |
| -32000 | `command_failed` | `game.capture` gave no picture (`data.id` is `editor.capture` or `editor.sheet`). A series took no picture. A series is already recording. |
| -32000 | (from the dispatcher) | The door itself threw. Its error passes through capture unchanged. |

## Events

None. The plugin declares no events, emits none and hooks none.

## Dependencies

| Kind | Name | Use |
|---|---|---|
| depends | `registryPlugin` | `ctx.require(registryPlugin)` in `onInit`. |
| registry member | `add(entry)` | Adds the four commands in `onInit`. A duplicate id throws, so `createApp` fails loudly. |
| registry member | `command("game.capture")` | The door entry, looked up at run time, so module order does not matter. |
| registry member | `envelope()` | The `state` of `editor.seriesStop`. |
| global events | none | |

Package: no runtime dependency beyond the framework. `@moku-labs/game` is not imported: `game.capture` is a string id.

## Lifecycle

| Phase | What |
|---|---|
| `createState` | `createCaptureState()`: `{ series: undefined }`. |
| `onInit` | `initCapture`: adds `editor.capture`, `editor.series`, `editor.seriesStop`, `editor.sheet`, with the browser clock and the page decoder `decodePicture`. Runs in init because the registry builds its manifest from entries added before start. |
| `onStart` | Not used. |
| `onStop` | `stopCapture`: ends a running series. The pending call resolves with the shots so far. No timer outlives the app. |

## Usage

Game dev entry:

```ts
import { bridgePlugin, capturePlugin, createApp } from "@moku-labs/editor/agent";

const devPlugins = __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [];
const editor = createApp({
  plugins: devPlugins,
  pluginConfigs: {
    registry: { game: app, modules: [] },
    capture: { maxDurationMs: 10_000 }
  }
});
await editor.start();
```

In process, without the bridge:

```ts
const ran = await editor.channel.run("editor.capture");
ran.state.frame === ran.value.frame; // true
```

## Integration

| Plugin | Core | How it meets capture |
|---|---|---|
| `registry` | agent | Holds the four commands and the `game.capture` door. Lists them in the manifest with effect `read`. |
| `channel` | agent | `channel.run("editor.capture")` runs a command in process. |
| `bridge` | agent | Forwards `run` calls from the hub. Deadline of `run` of `editor.series`: `callTimeoutMs + min(durationMs, 60000)`; of `editor.sheet`: `callTimeoutMs + min(frames × everyMs, 60000)` (`deadlineFor`). |
| `hub` | server | Same long-call rule for forwarded `editor.series` and `editor.sheet` calls (`deadlineFor`). |
| `link` | tools | `link.run` calls the commands. Same long-call rule (`timeoutFor`). |
| MCP bridge | `moku-editor mcp` | `moku_screenshot` runs `editor.capture { maxWidth }`; `moku_series` runs `editor.sheet { frames, everyMs, maxWidth: 1080 }`, or `game.capture { sheet }` when the agent has no `editor.sheet`. |
| `gameView` | tools | Runs the three ids (`GAME_COMMANDS`). Saves PNGs under `capturesDir` (default `.moku/captures`) with `link.files.writeBinary`. A series becomes a `series-<stamp>/` folder with numbered PNGs and `index.json`. `stopSeries()` runs `editor.seriesStop`. |

## Limits and follow-ups

- Timing is best effort. `game.capture` resolves at the end of the next drawn frame plus the GPU read-back. A 16 ms interval gives about one shot per drawn frame.
- Two shots can carry the same frame while the game is paused.
- A 20 s series at 16 ms plans 1250 PNG data URLs in one response. The `WARN_SHOTS` warning flags it. Streaming shots is a follow-up. Chunking is not allowed (R1).
- `game.capture` needs `__MOKU_GAME_DEV__`. Otherwise the door refuses and the error comes back as -32000.
- The frame tag can be one frame early after a GPU read-back. It is the engine's envelope frame, never a planned one.
- `maxWidth` shrinks `editor.capture` and `editor.sheet`. `editor.series` shots stay full size.
- Log events: `capture:series-large`, `capture:shots-skipped` and `capture:downscale-failed`, all at warn.
