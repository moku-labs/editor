# workspace

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools shell and the one game frame.

The shell of the tools page: top bar (B1), rail with badges (B2), pinned game preview (B3), step
and registry popovers (D1, D2), link pill note (D7), command palette (E1), toasts (F1), stale bar
(F3) and the connecting and no-game cards (F4). It owns the single game iframe, the per-viewer
preferences (theme, preview per workspace, device), the key map with the Esc unwinding, the
overlay-in-game switch and the D-07 reload. It also ships the shared CSS layer every view uses
(`styles/`).

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `defaultWorkspace` | `WorkspaceId` | `"flow"` | Workspace shown at start when the URL hash names none. |
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
| `onPrefs` | `(fn) => () => void` | Called after every theme, preview or device change. |

```ts
workspace.show("game");
workspace.preview("flow").size; // "S"
workspace.setPreview("render", { visible: false });
workspace.device().preset.w; // 393
workspace.setDevice({ orientation: "landscape" });
await workspace.gameFrame().reload({ restore: true });
const remove = workspace.palette.add({ id: "cmd:capture", group: "Commands", label: "Take a screenshot", run });
workspace.toast("✓ Note saved", ".moku/notes/2026-09-24-first-top-item.md");
workspace.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
workspace.previewZone("flow", canvasEl, () => ({ top: 56, bottom: 56 }));
workspace.keys.bind({ keys: "n", label: "New note", workspace: "flow", run });
workspace.keys.escape("noteEditor", () => editor.close());
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
| Other workspace, preview visible | Over the preview body. Takes no pointer events. |
| Otherwise | Hidden. |

Every float that can cover the frame uses the browser top layer (`<dialog>` or `popover`).

Before `mount` there is no iframe: `box()` is `undefined` and `reload()` resolves
`{ restored: false, reason: "not_mounted" }`.

### reload (D-07)

`reload({ restore: true })`: `game.bookmark` → `iframe.src` reassigned on the same element → first
manifest of an embedded session → `game.restore { bookmark }` → toast "Game reloaded · state
restored from the last checkpoint". Concurrent calls share one run and schedule one more after it.
Bookmark and restore are not user runs: no `workspace:ran`.

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
| ⌘1–⌘6 and 1–6 | Flow · Game · Render · State · Files · Console |
| ⌘K | Palette, also in inputs |
| `.` | Step one frame, only while paused |
| P | Pause / resume |
| O | Overlay in game on / off |
| G | Show / hide the preview of the current workspace |
| Esc | Closes one thing, in this order: palette → contactSheet → contextMenu → noteEditor → registry → seriesPopover → captureCard → picker → fileEdit → codeEdit → stepPopover → selection |

- `mod` is ⌘ on Apple platforms, Ctrl elsewhere.
- Single keys are ignored in fields unless the binding sets `inInputs`.
- While the palette is open, only the palette handles keys.
- Bindings of the active workspace win over global ones.
- `keys.bind` throws `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash where neither binding has `when`.
- Within one Esc layer, the latest registration is asked first.
- workspace registers the Esc layers `palette`, `contextMenu` (the session menu), `registry` and `stepPopover`. The views register the rest.

## Events

workspace declares no plugin events. It uses global tools events from `src/config.ts`.

| Direction | Event | Payload | When |
|---|---|---|---|
| emits | `workspace:changed` | `{ ws: WorkspaceId }` | `show()` changed the workspace. |
| emits | `workspace:ran` | `RanEvent` | A command the shell ran for the user settled. Origins `topbar`, `key`, `palette`. |
| hooks | `link:status` | `{ status, session? }` | Stores the status for the pill, stale bar and cards. Runs a 1 s ticker while `silent` or `lost`. Closes the step popover when not live or paused. |

`RanEvent` = `{ id, input, origin, at }` plus `{ ok: true, result }` or `{ ok: false, error }`.

## Dependencies

| Kind | What |
|---|---|
| `depends` | `linkPlugin`: `status`, `manifest`, `onManifest`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`. |
| Global events | emits `workspace:changed`, `workspace:ran`; hooks `link:status`. |
| Packages | `preact`, `preact/hooks`. Dev: `happy-dom` for the component tests. |

## Usage

The tools page entry mounts the shell after start (R3). `onStart` never mounts.

```ts
import { createApp } from "@moku-labs/editor/tools";

const tools = createApp({ pluginConfigs: { workspace: { defaultWorkspace: "game" } } });
await tools.start();
tools.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
```

From a view plugin:

```ts
const workspace = ctx.require(workspacePlugin);
workspace.keys.bind({ keys: "n", label: "New note", workspace: "flow", run: openNote });
```

## Lifecycle

| Phase | Does |
|---|---|
| `onInit` | Validates config, loads prefs, reads the OS theme and the hash, registers built-in keys, Esc layers and palette Commands. No DOM writes. |
| `onStart` | Adds window listeners and the `link.onManifest` listener (palette, reload restore, overlay re-apply). No mount. |
| `mount(el)` | Renders the shell, sets `data-theme` on `<html>`, attaches hosts, creates the frame layer once. |
| `onStop` | Runs every cleanup, clears toast, ticker and reload timers, unrenders, removes the frame layer and the hosts. |

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

- Keys pressed while the game iframe has focus go to the game. The preview never lets the iframe take focus; in the Game stage a click outside the device returns the keys.
- The browser may keep ⌘1–⌘6. Bare 1–6, the rail and the palette are the fallback.
- A hidden iframe can be throttled by the browser. The link pill shows the frame number stop.
- localStorage missing, full or corrupt: defaults and one warn. Nothing essential is stored.
