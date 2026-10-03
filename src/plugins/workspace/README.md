# workspace

> Complex plugin (tools core) — the tools shell and the one game frame.

The shell of the tools page: top bar (B1), rail with badges (B2), pinned game preview (B3), step
and registry popovers (D1, D2), link pill note (D7), command palette (E1), toasts (F1), stale bar
(F3) and the connecting / no-game cards (F4). It owns the single game iframe, the per-viewer
preferences (theme, preview per workspace, device), the keyboard map with the Esc unwinding, the
overlay-in-game switch and the D-07 reload. It also ships the shared CSS layer every view uses
(`styles/`).

The tools page entry mounts it after start (R3):

```ts
const editor = createApp({});
await editor.start();
editor.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
```

`onStart` never mounts. Before `mount` there is no iframe: `gameFrame().box()` is `undefined` and
`gameFrame().reload()` resolves `{ restored: false, reason: "not_mounted" }`. Hosts exist before
`mount`, so panels can render into them in its own `onStart`.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `defaultWorkspace` | `"flow"` | Workspace shown at start when the URL hash names none. |
| `storageKey` | `"moku-editor"` | localStorage key of the preferences record. |
| `reloadTimeoutMs` | `15000` | How long `reload()` waits for the new session. |
| `toastMs` | `2600` | How long one toast stays (hover or focus pauses it). |

`onInit` throws `[moku-editor] workspace.<field> is invalid.` for a bad value. The game URL comes
from the boot JSON (`link.boot()?.gameUrl`, else `"/"`), not from config.

## API (`app.workspace`, `tools.workspace`)

| Member | Does |
|---|---|
| `active()` / `show(ws)` | The shown workspace; `show` emits `workspace:changed` when it changes and writes `#<ws>`. |
| `theme()` / `setTheme(theme?)` | Effective theme (chosen, else OS); `setTheme()` toggles and persists. |
| `preview(ws)` / `setPreview(ws, patch)` | Preview of a non-Game workspace (`visible`, `size`, `corner` + px size); a visibility change toasts "Game preview hidden in Flow · remembered for this workspace". |
| `device()` / `setDevice(patch)` / `devices()` | `{ preset: DeviceSpec, orientation }`, the six presets; a change resizes the frame. |
| `gameFrame()` | `{ url, reload({ restore }), dock(slot, { fit, clip? }), overlay(), box() }`. |
| `palette.add(items)` / `palette.open(query?)` | Palette index (an id is replaced; the remover keeps newer items). |
| `toast(message, file?)` | One-line toast; `file` in mono after a middle dot. Max 3. |
| `mount(el)` | Renders the shell; the first call creates the frame layer in `document.body`. |
| `host(ws)` | The `<section data-workspace-host>` panels renders into. |
| `badge(ws, badge \| undefined)` | Rail badge, e.g. `{ count: 3, tone: "error", label: "2 warn · 1 error" }`. |
| `previewZone(ws, el, insets?)` | Where the preview floats in a workspace (default: its host, 12 px margin). |
| `keys.bind(binding)` / `keys.escape(layer, close)` | Key map and Esc layers (see below). |
| `overlayInGame()` / `setOverlayInGame(on)` | The overlay switch; runs `editor.overlay`, toasts, re-applies on every new session. |
| `onPrefs(fn)` | Called after every theme, preview or device change. |

### The game frame (D-14)

One `<iframe data-game-frame>` for the page's life, inside `<div data-frame-layer>` (fixed, above
the content) → `<div data-frame-box>` (device size, `transform: translate() scale()`). It never
moves in the DOM: docking writes a transform and a `clip-path`. In Game the frame sits over the
stage slot gameView docks (`fit` capped at 1, or `actual`); elsewhere over the preview body while
the preview is visible; otherwise hidden. Every float that can cover it uses the browser top layer
(`<dialog>` or `popover`). In the preview the iframe takes no pointer events: clicks and drags go
to the preview chrome below it.

### reload (D-07)

`reload({ restore: true })`: `game.bookmark` → `iframe.src` reassigned (same element) → the first
manifest of an embedded session → `game.restore { bookmark }` → toast "Game reloaded · state
restored from the last checkpoint". Concurrent calls share one run and schedule one more after it.
Results: `not_mounted`, `not_embedded`, `no_session`, `bookmark_failed`, `restore_failed`,
`timeout`. Bookmark and restore are not user runs: no `workspace:ran`.

### Keys and Esc

| Key | Action |
|---|---|
| ⌘1–⌘6 and 1–6 | Flow · Game · Render · State · Files · Console |
| ⌘K | Palette (also in inputs) |
| `.` | Step one frame, only while paused |
| P | Pause / resume |
| O | Overlay in game on / off |
| G | Show / hide the preview of the current workspace |
| Esc | Closes one thing: palette → contact sheet → context menu (and the session menu) → note editor → registry → series → capture card → picker → file edit → code edit → step popover → selection |

`mod` is ⌘ on Apple platforms, Ctrl elsewhere. Single keys are ignored in fields unless the
binding sets `inInputs`. Workspace-scoped bindings of the active workspace win over global ones;
`keys.bind` throws `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash without a
`when` condition.

## Events

Global tools-core events (declared in `src/config.ts`, R4); the plugin declares none of its own.

| Event | When |
|---|---|
| `workspace:changed { ws }` | `show()` changed the workspace. |
| `workspace:ran` (`RanEvent`) | A command the shell ran for the user settled (origins `topbar`, `key`, `palette`, `panel`). |

Hooks: `link:status` (pill, stale bar, cards, the 1 s ticker while silent or lost).

## Dependencies

- `linkPlugin` (`ctx.require`): `status`, `manifest`, `onManifest`, `run`, `sessions`, `session`,
  `choose`, `retry`, `boot`.
- `preact`, `preact/hooks`. Dev: `happy-dom` for the component tests.

## Styles

`styles/index.css` declares `@layer reset, tokens, base, components, animations, utilities` and
pulls every sheet of the plugin; the tools page CSS entry imports it first. See
[`styles/README.md`](styles/README.md).
