# overlay

> Standard plugin, agent core (`createAgentPlugin`). A default plugin of `@moku-labs/editor/agent`.

A small Preact card drawn over the running game in the game page. It shows the render numbers of `game.render` and one button per one-click cheat command. Nothing else: no graph controls. It is off by default.

## Configuration

Set through `pluginConfigs.overlay`. Defaults from `index.ts`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `open` | `boolean` | `false` | Open at start. A QA build sets `true`. |
| `corner` | `Corner`: `"top-right" \| "top-left" \| "bottom-right" \| "bottom-left"` | `"top-right"` | Corner of the game page the card sits in. |
| `mount` | `string \| undefined` | `undefined` | CSS selector of the element the host is appended to. `undefined` means `document.body`. |

Constants in `types.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `PAINT_MS` | `250` | Repaint cadence while open. |
| `OK_MS` | `1200` | How long a cheat button shows ✓. |
| `ERROR_MS` | `3000` | How long a cheat button shows !. |
| `Z_INDEX` | `2_147_483_000` | z-index of the host. |
| `HOST_ATTRIBUTE` | `"data-moku-editor-overlay"` | Attribute that marks the host element. |

## API

`app.overlay` is an `OverlayApi`.

| Member | Signature | Behaviour |
|---|---|---|
| `open` | `open(): void` | Sets the flag. When mounted: shows the host, lists the cheats, watches `game.render`, starts the `PAINT_MS` interval, paints now. Before start it only sets the flag; `onStart` honours it. Idempotent. |
| `close` | `close(): void` | Clears the flag, hides the host, stops the render watch, clears the interval. Idempotent. |
| `isOpen` | `isOpen(): boolean` | The flag. |

```ts
editor.overlay.isOpen(); // false: the overlay is off by default
editor.overlay.open();   // the card appears in the top-right corner of the game page
editor.overlay.isOpen(); // true
editor.overlay.close();
```

### Registry command

Added to the registry in `onInit`, so it is in the manifest before start.

| Id | Title | Input | Effect | Value |
|---|---|---|---|---|
| `editor.overlay` | `Overlay in game` | `{ on: "boolean" }` | `cosmetic` | `{ on: boolean }`, the flag after the call |

The command runs no door. Its `state` is `registry.envelope()`. Bad input is refused with -32602.

```ts
await link.run("editor.overlay", { on: true });
// { value: { on: true }, state: { path: "board/awaitIntent", frame: 1840, tainted: false } }
```

### What the card shows

Render chips (`renderChips`):

| Case | Chips |
|---|---|
| Numbers present | `fps 60`, `4.1 ms`, `textures 31.1 MB` |
| No numbers yet | `render …` |
| `game.render` missing or its read threw | `render —`, title `game.render is not available in this build` |

Cheat buttons (`cheatCommands`): commands with effect `cheat` whose input has no required field, in manifest order. A cheat with required input is left out. No cheats shows `No cheats registered`. A click runs the cheat through `channel.run`. A busy cheat ignores clicks. The status line reads `Cheat sent: <title>` or `Cheat failed: <message>`.

Link dot (`linkLabel`), only when a plugin named `bridge` is composed:

| `LinkStatus` kind | Label |
|---|---|
| `connecting` (before the first event) | `Connecting to the editor` |
| `live` | `Editor live · frame N` |
| `paused` | `Game paused · frame N` |
| `silent` | `Editor silent · last frame N` |
| `lost` | `Editor link lost · retry in N s` |
| `empty` | `No editor session` |

## Events

| Direction | Event | Payload | When |
|---|---|---|---|
| Emitted | none | | |
| Hooked | `bridge:status` (global, `AgentEvents` in `src/config.ts`) | `{ status: LinkStatus; session?: string }` | The bridge link changed kind or session. Stores status and session; repaints when open. |

Log events (`ctx.log.warn`):

| Event | Data | When |
|---|---|---|
| `overlay:render-unavailable` | `{ reason }` | `channel.watch("game.render", …)` threw on open. |
| `overlay:cheat-failed` | `{ id, code, message }` | A cheat run failed. |
| `overlay:mount-missing` | `{ mount }` | The `mount` selector matched nothing; body is used. |
| `overlay:no-dom` | | No `document`; nothing is mounted. |

## Dependencies

| Kind | Name | Used for |
|---|---|---|
| `depends` | `registryPlugin` | `add` (the `editor.overlay` command), `manifest` (cheat list), `envelope` (command state). |
| `depends` | `channelPlugin` | `watch("game.render", …)`, `run(cheatId)`. |
| Presence check | `ctx.has("bridge")` | Link dot on or off, checked in `onStart`. No import of `bridgePlugin`. |
| Global event | `bridge:status` | Feeds the link dot. |

Lifecycle:

| Hook | Function | Does |
|---|---|---|
| `onInit` | `initOverlay` | Adds `editor.overlay`. A duplicate id throws. |
| `onStart` | `startOverlay` | Creates the host, open shadow root and stylesheet, the isolation listener, paints the card hidden. Opens when `open()` was called before start or `config.open` is true. |
| `onStop` | `unmountOverlay` | Clears the interval, stops the watch, unrenders, removes the listener and the host. |

## Usage

```ts
import { createApp } from "@moku-labs/editor/agent";

// QA build: the card is open at start in the bottom-left corner.
const editor = createApp({
  pluginConfigs: { registry: { game }, overlay: { open: true, corner: "bottom-left" } }
});
await editor.start();

editor.overlay.close();
```

From another agent plugin, switch it through the registry command:

```ts
await ctx.require(channelPlugin).run("editor.overlay", { on: true });
```

## Integration notes

- `registry`: the overlay reads `manifest()` on each `open()`. Cheats added after an open show on the next open.
- `channel`: the watch callback runs in the game frame loop. It only stores the numbers. The `PAINT_MS` interval repaints.
- `bridge`: emits `bridge:status` through `ctx.emit`. Without a bridge the hook never fires and no dot is drawn.
- `workspace` (tools core): owns the tools-side flag. `setOverlayInGame(on)` runs `editor.overlay` through link and re-applies it for each new session. `overlayInGame()` reads the flag.
- `gameView` (tools core): its Device tab and palette call `workspace.setOverlayInGame`.
- Input isolation: the host stops `pointerdown`, `pointerup`, `pointermove`, `click`, `wheel`, `touchstart`, `touchend`, `keydown`, `keyup`. Overlay input never reaches the game's window or document listeners. The host is fixed and 212 px wide, so the game keeps every event outside the card.
- Styles live in a shadow root. `overlayCss` is adopted through `adoptedStyleSheets`, with a `<style>` fallback.

## Limits

- Off by default. A fresh app has a hidden host, no render watch and no interval.
- Only render chips and one-click cheats. A cheat with required input must be run from the editor.
- The headless app has no renderer, so the chip reads `render —`.
- After a game reload the overlay resets to `config.open`. The tools side re-runs `editor.overlay` after reconnect.
- No backdrop blur: it costs too much over a GPU canvas (WebGPU or WebGL).
- Game follow-ups: none named in the spec.
