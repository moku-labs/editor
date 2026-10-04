# workspace

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools shell and the one game frame.

The shell of the tools page: top bar (B1), rail with badges (B2), pinned game preview (B3), step
and registry popovers (D1, D2), link pill note (D7), command palette (E1), toasts (F1), stale bar
(F3) and the connecting and no-game cards (F4). It owns the single game iframe, the per-viewer
preferences (theme, density, preview per workspace, device, Show taps), the key map with the Esc
unwinding, the overlay-in-game switch, Reference mode, the tap ripples and the D-07 reload. It
also ships the shared CSS layer every view uses (`styles/`).

The shell is built narrow first: it runs in a browser pane at a third (480 px) or half (720 px)
of the screen. Under 560 px the top bar keeps the logo and the controls only, and the rail is 44 px
of icons. No workspace scrolls the page sideways.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `defaultWorkspace` | `WorkspaceId` | `"game"` | Workspace shown at start when the URL hash names none. |
| `storageKey` | `string` | `"moku-editor"` | localStorage key of the preferences record. |
| `reloadTimeoutMs` | `number` | `15000` | How long `reload()` waits for the new session. |
| `toastMs` | `number` | `2600` | How long one toast stays. Hover or focus pauses it. |

`onInit` throws `[moku-editor] workspace.<field> is invalid.\n  <fix>.` for a bad value. The game
URL comes from the boot JSON (`link.boot()?.gameUrl`, else `"/"`), not from config.

## API

`app.workspace`, and `tools.workspace` in every panel view. Type `WorkspaceApi`.

| Member | Signature | What it does |
|---|---|---|
| `active` | `() => WorkspaceId` | The shown workspace. |
| `show` | `(ws) => void` | Shows a workspace, writes `#<ws>`, emits `workspace:changed` when it changed. |
| `theme` | `() => Theme` | Effective theme: the chosen one, else the OS one. |
| `setTheme` | `(theme?) => void` | Sets the theme, or toggles without an argument. Persists. |
| `density` | `() => Density` | The applied density: `compact` or `comfortable`. |
| `setDensity` | `(value: DensityChoice) => void` | `auto`, `compact` or `comfortable`. Persists, sets `data-density` on `<html>`, emits `workspace:density` when the applied value changes. |
| `preview` | `(ws: PreviewWorkspace) => PreviewState` | Preview of a non-Game workspace: `visible`, `size`, `corner`, plus `width` and `height` in px. |
| `setPreview` | `(ws, patch) => void` | Patches the preview. A visibility change toasts "Game preview hidden in Flow · remembered for this workspace". |
| `device` | `() => DeviceChoice` | `{ preset: DeviceSpec, orientation }`. Default `iphone-15`, portrait. |
| `setDevice` | `(patch) => void` | Changes preset or orientation. The frame resizes. |
| `devices` | `() => readonly DeviceSpec[]` | The six presets: iPhone SE, iPhone 15, iPhone 15 Pro Max, Pixel 8, iPad mini, Desktop. |
| `gameFrame` | `() => GameFrame` | `{ url, reload(opts?), dock(slot, { fit, clip? }), overlay(), box() }`. |
| `palette.add` | `(item \| items) => () => void` | Adds palette items. A known id is replaced. The remover keeps newer items. |
| `palette.open` | `(query?) => void` | Opens the palette. |
| `toast` | `(message, file?) => void` | One-line toast. `file` shows in mono after a middle dot. At most 3. |
| `mount` | `(element) => void` | Renders the shell. The first call creates the frame layer in `document.body`. A later call moves the shell, not the frame layer. |
| `host` | `(ws) => HTMLElement` | The `<section data-workspace-host>` panels renders into. Same element before and after `mount`. |
| `badge` | `(ws, badge \| undefined) => void` | Rail badge, or clears it. |
| `previewZone` | `(ws, element, insets?) => () => void` | Where the preview floats in a workspace. Default: its host, 12 px margin. |
| `keys.bind` | `(binding) => () => void` | Adds a key binding. |
| `keys.escape` | `(layer, close) => () => void` | Adds an Esc closer to a layer. |
| `overlayInGame` | `() => boolean` | The overlay-in-game switch. Always `false` at load. |
| `setOverlayInGame` | `(on) => Promise<void>` | Runs `editor.overlay`, toasts, re-applies on every new session. A failure puts the flag back. |
| `reference` | `() => boolean` | Reference mode. Always `false` at load. Never persisted. |
| `setReference` | `(on) => void` | Turns Reference mode on or off. Emits `workspace:reference` on a change. |
| `onPrefs` | `(fn) => () => void` | Called after every theme, preview or device change. |

```ts
workspace.show("flow");
workspace.setDensity("compact");
workspace.density(); // "compact"
workspace.setReference(true); // the game gets no input; gameView draws its proxies
workspace.preview("flow").size; // "S"
workspace.setPreview("render", { visible: false });
workspace.device().preset.w; // 393
workspace.setDevice({ orientation: "landscape" });
await workspace.gameFrame().reload({ restore: true });
const remove = workspace.palette.add({ id: "cmd:capture", group: "Commands", label: "Take a screenshot", run });
workspace.toast("Saved", "src/styles.ts");
workspace.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
workspace.previewZone("flow", canvasEl, () => ({ top: 56, bottom: 56 }));
workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run });
workspace.keys.escape("contextMenu", () => menu.close());
await workspace.setOverlayInGame(true);
const off = workspace.onPrefs(prefs => rerender(prefs));
```

### The game frame (D-14)

One `<iframe data-game-frame>` for the page's life, inside `<div data-frame-layer>` (fixed, above
the content) → `<div data-frame-box>` (device size, `transform: translate() scale()`). It never
moves in the DOM. Docking writes a transform and a `clip-path`.

| Where | Frame |
|---|---|
| Game workspace | Over the stage slot gameView docks. `fit` (scale capped at 1) or `actual`. |
| Other workspace, preview visible | Over the preview body. The game takes the pointer and the keyboard: the preview plays the game. |
| Otherwise | Hidden. |

The docked iframe has `tabIndex` 0, the hidden one -1.

### The pinned preview

The header is the handle: a drag on it moves the float and snaps it to the nearest corner;
Alt+arrows on it move it a corner. The body belongs to the game. The size changes only through
S/M/L. "Open in Game (⌘1)" shows the Game workspace.

### Reference mode (D-27)

The top-bar button (`data-action="reference"`, `aria-pressed`), key R, the palette item
"Reference mode on/off" and `setReference` drive it. While it is on, the frame box carries
`data-reference`: the overlay takes the pointer, so the game gets no input, and a 1 px accent
outline marks the frame. gameView draws its element proxies into `gameFrame().overlay()`. Esc
turns it off (layer `reference`, just before `selection`).

### Tap ripples

workspace subscribes once to `link.onTap`. While the frame is docked and Show taps is on, a tap
draws a 20 px accent ring at the tap point in the overlay (device px). It grows to 36 px and fades
in 400 ms. Under reduced motion it is a static dot for 300 ms. At most 8 live at once. The palette
item "Show taps in the game" turns them on or off; its hint says `on` or `off`.

### Density

`auto` (the default) is compact below 820 px of window width and comfortable from there. It is
re-resolved on every window resize. The palette items `workspace:density-auto`, `-compact` and
`-comfortable` ("Density: …") choose it; the one in use is dimmed. The tokens are in
`styles/tokens.css`.

Every float that can cover the frame uses the browser top layer (`<dialog>` or `popover`).

The frame loads `link.frameUrl(url)`: the game URL with this tools page's frame id in the
`__editorFrame` query parameter. `gameFrame().url` stays the untagged game URL.

Before `mount` there is no iframe: `box()` is `undefined` and `reload()` resolves
`{ restored: false, reason: "not_mounted" }`.

### reload (D-07)

`reload({ restore: true })`: `game.bookmark`, and whether the link is `paused` → `iframe.src`
reassigned on the same element → first manifest of this tab's own embedded frame (a manifest
whose page carries another tools page's frame id is skipped) → `game.restore { bookmark }` →
`game.pause` when the game was paused and the new manifest lists it → toast "Game reloaded · state
restored from the last checkpoint". A failed `game.pause` is the warn `workspace:pause-failed`; the
result stays `{ restored: true }`. Concurrent calls share one run and schedule one more after it.
Bookmark, restore and pause are not user runs: no `workspace:ran`.

| `reason` | When |
|---|---|
| `not_mounted` | No `mount` yet. |
| `not_embedded` | The game runs outside the editor. |
| `no_session` | No game connected. |
| `bookmark_failed` | `game.bookmark` failed. |
| `restore_failed` | `game.restore` failed. The game stays at its fresh start. |
| `timeout` | No new session within `reloadTimeoutMs`. |

### Keys and Esc

| Key | Action |
|---|---|
| ⌘1–⌘6 and 1–6 | Game · Flow · Render · State · Files · Console |
| ⌘K | Palette, also in inputs |
| `.` | Step one frame, only while paused |
| P | Pause / resume |
| O | Overlay in game on / off |
| G | Show / hide the preview of the current workspace |
| R | Reference mode on / off |
| Esc | Closes one thing, in this order: palette → contactSheet → contextMenu → registry → seriesPopover → captureCard → picker → fileEdit → codeEdit → stepPopover → reference → selection |

- `mod` is ⌘ on Apple platforms, Ctrl elsewhere.
- Single keys are ignored in fields unless the binding sets `inInputs`.
- While the palette is open, only the palette handles keys.
- Bindings of the active workspace win over global ones.
- `keys.bind` throws `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash where neither binding has `when`.
- Within one Esc layer, the latest registration is asked first.
- workspace registers the Esc layers `palette`, `contextMenu` (the session menu), `registry`, `stepPopover` and `reference`. The views register the rest.

## Events

workspace declares no plugin events. It uses global tools events from `src/config.ts`.

| Direction | Event | Payload | When |
|---|---|---|---|
| emits | `workspace:changed` | `{ ws: WorkspaceId }` | `show()` changed the workspace. |
| emits | `workspace:ran` | `RanEvent` | A command the shell ran for the user settled. Origins `topbar`, `key`, `palette`. |
| emits | `workspace:density` | `{ density: "compact" \| "comfortable" }` | The applied density changed: a choice, or `auto` crossing 820 px on a resize. |
| emits | `workspace:reference` | `{ on: boolean }` | Reference mode turned on or off. |
| hooks | `link:status` | `{ status, session? }` | Stores the status for the pill, stale bar and cards. Runs a 1 s ticker while `silent` or `lost`. Closes the step popover when not live or paused. |

`RanEvent` = `{ id, input, origin, at }` plus `{ ok: true, result }` or `{ ok: false, error }`.

## Dependencies

| Kind | What |
|---|---|
| `depends` | `linkPlugin`: `status`, `manifest`, `onManifest`, `onTap`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`. |
| Global events | emits `workspace:changed`, `workspace:ran`, `workspace:density`, `workspace:reference`; hooks `link:status`. |
| Packages | `preact`, `preact/hooks`. Dev: `happy-dom` for the component tests. |

## Usage

The tools page entry mounts the shell after start (R3). `onStart` never mounts.

```ts
import { createApp } from "@moku-labs/editor/tools";

const tools = createApp({ pluginConfigs: { workspace: { defaultWorkspace: "flow" } } });
await tools.start();
tools.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
```

From a view plugin:

```ts
const workspace = ctx.require(workspacePlugin);
workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run: findCurrent });
```

## Lifecycle

| Phase | Does |
|---|---|
| `onInit` | Validates config, loads prefs, reads the OS theme, the density and the hash, registers built-in keys, Esc layers and palette Commands. No DOM writes. |
| `onStart` | Adds window listeners (keys, resize with the auto density, scroll), the `link.onManifest` listener (palette, reload restore, overlay re-apply) and the `link.onTap` listener (ripples). No mount. |
| `mount(el)` | Renders the shell, sets `data-theme` and `data-density` on `<html>`, attaches hosts, creates the frame layer once. |
| `onStop` | Runs every cleanup, clears toast, ticker, reload and ripple timers, unrenders, removes the frame layer and the hosts. |

## Integration notes

- `panels` renders into `host(ws)` and mounts on `workspace:changed`. Hosts exist before `mount`, so panels can render in its own `onStart`.
- `panels.run` emits `workspace:ran` with origin `panel`. Views never emit it themselves.
- gameView docks the frame with `gameFrame().dock(slot, { fit })` and draws over it with `gameFrame().overlay()`.
- Views add palette items, key bindings, Esc closers and preview zones. Each returns a remover.
- consoleView and stateView hook `workspace:ran`.

## Styles

`styles/index.css` declares `@layer reset, tokens, base, components, animations, utilities` and
pulls every sheet of the plugin. The tools page CSS entry imports it first. Token values live only
in `styles/tokens.css`. TypeScript names for them are in `../panels/shared/tokens.ts`. See
[`styles/README.md`](styles/README.md).

## Limits

- Keys pressed while the game iframe has focus go to the game. A click in the preview or on the Game stage gives the game the keys; a click outside the device returns them.
- The browser may keep ⌘1–⌘6. Bare 1–6, the rail and the palette are the fallback.
- A hidden iframe can be throttled by the browser. The link pill shows the frame number stop.
- localStorage missing, full or corrupt: defaults and one warn. Nothing essential is stored. A record from before density and Show taps loads them as their defaults.

## Breaking changes (Claude-pane round)

- `defaultWorkspace` defaults to `"game"`.
- ⌘1 is Game and ⌘2 is Flow (was Flow, Game).
- A click on the preview body no longer cycles the size: the game gets it.
