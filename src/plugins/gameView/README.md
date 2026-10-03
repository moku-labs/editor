# gameView

> Complex plugin (tools core). The Game workspace (design A2): device toolbar, dotted stage with the one game frame, element picker, the Element and Device tabs, screenshots, series and the contact sheet.

gameView depends on no view, and no view depends on it (R4, D-13).
It reaches other views only through global tools-core events.

What it does:

- It docks the one game frame over its stage slot with `workspace.gameFrame().dock`. The iframe never moves (R4, D-14).
- It draws over the game only inside its own root in `gameFrame().overlay()`.
- It watches `game.ui`, `game.entities` and `game.projections` only while Game is shown (R6). No timer reads a frame source.
- It runs every command through `ctx.require(panelsPlugin).run(id, input)` (R9). There is no `link.run` in gameView.
- It never captures on its own. Only a user action or an api call takes a screenshot or a series.

The scene mapping, the note codec, the style edit and the token names are the shared modules of `panels/shared/` (R8). gameView keeps no copy of them.

## API

| Method | What |
|---|---|
| `pick(on?)` | Picker on, off, or toggled. On shows Game, the Element tab and the hint pill. |
| `selected()` | The picked element (`ElementRef`), or `undefined`. |
| `select(ref)` | Selects without the picker, or clears the selection. Clears the style card. |
| `inspect(ref)` | `select(ref)`, Element tab, shows Game. The `workspace:inspect` hook calls it. |
| `scene()` | The scene from the watched sources. While Game is hidden it reads the three sources once. |
| `locate(ref)` | The page rect of one element, from `scene()`. |
| `highlight(ref)` | The pink box over the game frame. `undefined` clears it. A newer call drops an older one. |
| `manifest()` | The texture catalogue of the first readable `manifestPaths` entry. Cached per session. |
| `capture()` | One screenshot through `editor.capture`, written to `.moku/captures/<yyyy-mm-dd-hhmm>-<flow>.png`. |
| `series(options)` | One `editor.series` call. Writes `series-<stamp>/NNN.png` and `index.json`, opens the contact sheet. |
| `stopSeries()` | Runs `editor.seriesStop`. The pending series resolves with the shots taken so far. |
| `openSheet(indexPath)` | Opens a saved series. Reads `index.json`, then every PNG with `readBinary`. |
| `attach(capture, notePath)` | Adds the capture to the note's front matter `captures[]` once, written with the version. |
| `notes()` | Notes under `notesDir`, newest first by file name. |

```ts
const game = ctx.require(gameViewPlugin);
game.pick(true);                                  // Game shown, picker on
const shot = await game.capture();                // { path: ".moku/captures/2026-09-24-1012-board.png", frame: 1841, device: "iPhone 15 portrait", image: "data:image/png;base64,…" }
await game.series({ durationMs: 2000, intervalMs: 100 });
```

Failures never throw out of `capture`, `series`, `openSheet` or `attach`.
They show a toast with the bare message (`bareMessage`, R7) and log the full one with its code.

## Configuration

| Option | Default | What |
|---|---|---|
| `capturesDir` | `".moku/captures"` | Folder of screenshots and series. |
| `notesDir` | `".moku/notes"` | Folder of notes. |
| `manifestPaths` | `["manifest.json", "public/manifest.json", "web/manifest.json"]` | Where the asset manifest may live, tried in order. |
| `captureCardMs` | `10000` | The capture card hides after this, unless hovered or focused (checked again every 2 s). |
| `seriesDurationsMs` | `[1000, 2000, 5000, 10000, 20000]` | Duration chips of the series popover. |
| `seriesIntervalsMs` | `[16, 50, 100, 250, 500, 1000]` | Interval chips of the series popover. |
| `seriesWarnShots` | `200` | The popover warns above this many planned shots. |
| `sourceSearch` | `{ maxFiles: 400, skip: ["node_modules", "dist", ".git", ".moku"] }` | Search for the style block of a picked element. |

## Events

gameView declares no events.

| Direction | Event | When |
|---|---|---|
| emits | `workspace:reveal { ref }` | Element tab "Show in render tree" (renderView hooks it). |
| emits | `workspace:new-note { captures, from? }` | "New note…" in the capture card or the contact sheet (flowView hooks it). |
| emits | `workspace:open-file { path, line }` | "Open in Files" on the style card (filesView hooks it). |
| hooks | `link:status` | A new session drops scene, calibration and manifest. `empty` turns the picker off, closes the popover and ends a series early. |
| hooks | `workspace:changed` | Entering Game starts the scene watches. Leaving stops them and turns the picker off. |
| hooks | `workspace:open-sheet { index }` | Opens that contact sheet. |
| hooks | `workspace:inspect { ref }` | Shows Game and inspects the element. |

## Lifecycle

- **onInit** registers the Game panel. It adds the palette items: Select element, Take a screenshot, Record a series…, Overlay in game and the six devices. It binds the keys and the Esc layers and listens to device changes. Sync, no I/O.
- **onStart** starts the scene watches when Game is already active (a restored `#game` hash).
- **onStop** runs the disposers and every unwatch, clears the timers and stops a running recording.

Keys, all through the workspace keymap:

- `mod+shift+c` and `i` toggle the picker.
- `←` / `→` step and `b` marks a bug, in Game while the contact sheet is open.

Esc layers, in the workspace rank: `contactSheet`, `seriesPopover`, `captureCard`, `picker`.

## Scene and picker

- One `game.rect` read per session and after a device change calibrates reference units to page px.
- Without a keyed element the calibration stays `undefined`. The hint pill then says "Picker needs one keyed element", and the picker selects nothing.
- A burst of watched values rebuilds the scene once, on the next animation frame.
- A value of the wrong shape keeps the last scene and logs `gameView: scene shape`.
- The picker maps the pointer through `pageFromClient(client, gameFrame().box())` and the shared `elementAt`.

## Style card

1. The search lists `.ts`/`.tsx` files breadth-first and finds the first line with `key="k"`, `key={"k"}` or `key: "k"` that has `style={ident}`.
2. The block is the `StyleBlockRef` `{ kind: "const", name: ident }`.
3. The shared style edit looks for it in that file first. If the ident is imported from a relative module, it then looks in that module (`.ts`, `.tsx`, `/index.ts`). This is how merge-game keeps its styles.
4. Steppers exist only for fields with a `fieldRule`.
5. A burst writes once with `writeNumber`. A success toasts "✓ Saved" and reloads the game with restore (D-07).

## Captures and notes

- A series index is `{ label, durationMs, intervalMs, fromFrame, shots: [{ file, frame, atMs, bug }], device?, stoppedEarly? }`.
- Bug marks save `index.json` 400 ms after the last toggle, with its version.
- A note whose front matter the shared codec cannot read is never rewritten.

## Files

`scene/` (watch, read, manifest), `stage/` (geometry, label, reload), `capture/` (naming, shot, series, sheet), `notes/attach.ts`, `element/` (source, styles, select), `keys.ts`, `palette.ts`, `commands.ts`, `report.ts`, `view-state.ts`, and `ui/` (Preact components and `ui/styles/*.css`, one `@scope ([data-game="…"])` per part, no `@layer` wrapper).

## Tests

- `__tests__/unit/`: one file per module and per component. The components run under happy-dom.
- `__tests__/integration/gameView.test.ts`: the real link, workspace, panels and gameView over an in-process hub, with the merge-game scene captures of panels.
- `__tests__/integration/merge-game.test.ts`: the scene, the watches and the picker over the real merge game through the agent channel. It runs only where `../game` exists.
