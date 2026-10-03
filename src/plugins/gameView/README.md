# gameView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Game workspace (design A2): device toolbar, dotted stage with the one game frame, element picker, the Element and Device tabs, screenshots, series and the contact sheet.

What it does:

- It docks the one game frame over its stage slot with `workspace.gameFrame().dock`. The iframe never moves (R4, D-14).
- It draws over the game only inside its own root in `gameFrame().overlay()`.
- It watches `game.ui`, `game.entities` and `game.projections` only while Game is shown (R6). No timer reads a frame source.
- It runs every command through `ctx.require(panelsPlugin).run(id, input)` (R9). There is no `link.run` in gameView.
- It never captures on its own. Only a user action or an api call takes a screenshot or a series.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `capturesDir` | `string` | `".moku/captures"` | Folder of screenshots and series. |
| `notesDir` | `string` | `".moku/notes"` | Folder of notes. |
| `manifestPaths` | `readonly string[]` | `["manifest.json", "public/manifest.json", "web/manifest.json"]` | Where the asset manifest may live, tried in order. |
| `captureCardMs` | `number` | `10_000` | The capture card hides after this, unless hovered or focused. Then it checks again every 2 s. |
| `seriesDurationsMs` | `readonly number[]` | `[1000, 2000, 5000, 10_000, 20_000]` | Duration chips of the series popover. |
| `seriesIntervalsMs` | `readonly number[]` | `[16, 50, 100, 250, 500, 1000]` | Interval chips of the series popover. |
| `seriesWarnShots` | `number` | `200` | The popover warns above this many planned shots. |
| `sourceSearch` | `{ maxFiles: number; skip: readonly string[] }` | `{ maxFiles: 400, skip: ["node_modules", "dist", ".git", ".moku"] }` | Search for the style block of a picked element. |

## API

`app.gameView` is `GameViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `pick` | `(on?: boolean) => void` | Picker on, off, or toggled. On shows Game, the Element tab and the hint pill. Off clears the hover box. |
| `selected` | `() => ElementRef \| undefined` | The picked element. |
| `select` | `(ref: ElementRef \| undefined) => void` | Selects without the picker, or clears the selection. Clears the style card. |
| `inspect` | `(ref: ElementRef) => void` | `select(ref)`, Element tab, shows Game. The `workspace:inspect` hook calls it. |
| `scene` | `() => Promise<SceneSnapshot>` | The scene from the watched sources. While Game is hidden it reads the three sources once. Rejects with the link's `WireError` when no game is connected. |
| `locate` | `(ref: ElementRef) => Promise<PageRect \| undefined>` | The page rect of one element, from `scene()`. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | The pink box over the game frame. `undefined` clears it. A newer call drops an older one still waiting for the scene. |
| `manifest` | `() => Promise<TextureCatalogue \| undefined>` | The texture catalogue of the first readable `manifestPaths` entry. Cached per session. |
| `capture` | `() => Promise<CaptureFile \| undefined>` | One screenshot through `editor.capture`, written to `<capturesDir>/<yyyy-mm-dd-hhmm>-<flow>.png`. `undefined` when there is no game, no `editor.capture`, or it failed. |
| `series` | `(options: { durationMs; intervalMs; label? }) => Promise<SeriesResult \| undefined>` | One `editor.series` call. Writes `series-<stamp>/NNN.png` and `index.json`, then opens the contact sheet. Refuses while another series runs. |
| `stopSeries` | `() => void` | Runs `editor.seriesStop`. The pending series resolves with the shots taken so far. Its index gets `stoppedEarly`. |
| `openSheet` | `(indexPath: string) => Promise<void>` | Opens a saved series. Reads `index.json`, then every PNG with `readBinary`. |
| `attach` | `(capture: string, notePath: string) => Promise<void>` | Adds the capture to the note's front matter `captures[]` once, written with the version. Toasts "✓ Attached to <title>". |
| `notes` | `() => Promise<readonly { path; title }[]>` | Notes under `notesDir`, newest first by file name. |

```ts
app.gameView.pick(true); // Game shown, picker on
app.gameView.selected(); // { kind: "ui", path: "boardScreen/hudRow/coinPill" }

const scene = await app.gameView.scene();
scene.nodes.get("ui:boardScreen/boardSlot")?.rect; // { x: 55, y: 801, w: 970, h: 970 }
await app.gameView.locate({ kind: "entity", id: 1_048_628 }); // { x: 428.5, y: 880.5, w: 223, h: 223 }

await app.gameView.capture();
// { path: ".moku/captures/2026-09-24-1012-board.png", frame: 1841, device: "iPhone 15 portrait", image: "data:image/png;base64,…" }

await app.gameView.series({ durationMs: 2000, intervalMs: 100 });
// { folder: ".moku/captures/series-2026-09-24-1015/", indexPath: ".moku/captures/series-2026-09-24-1015/index.json", shots: 20 }

await app.gameView.attach(
  ".moku/captures/2026-09-24-1012-board.png",
  ".moku/notes/2026-09-24-first-top-item.md"
);
```

Failures never throw out of `capture`, `series`, `openSheet` or `attach`.
They show a toast with the bare message (`bareMessage`, R7) and log the full one with its code.
Missing commands show "No game to capture. Connect a game first.", "The game did not add capturePlugin" or "The game did not add the overlay".

## Events

gameView declares no events. It uses the global tools events (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:reveal` | `{ ref }` | Element tab "Show in render tree". renderView hooks it. |
| Emits | `workspace:new-note` | `{ captures, from? }` | "New note…" in the capture card or the contact sheet. flowView hooks it. |
| Emits | `workspace:open-file` | `{ path, line }` | "Open in Files" on the style card. filesView hooks it. |
| Hooks | `link:status` | `{ status, session }` | Attached again after `lost`, or a new session: drops scene, calibration and manifest. `empty`: picker off, popover closed, a series ends early. |
| Hooks | `workspace:changed` | `{ ws }` | Entering Game starts the scene watches. Leaving stops them and turns the picker off. |
| Hooks | `workspace:open-sheet` | `{ index }` | Opens that contact sheet. |
| Hooks | `workspace:inspect` | `{ ref }` | Shows Game and inspects the element. |

Log events (warn): `gameView: calibration failed`, `gameView: highlight failed`, `gameView: manifest failed`, `gameView: reload failed`, `gameView: scene shape`, `gameView: series stop failed`, `gameView: style card failed`, `gameView: style search failed`.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of the scene sources; `read` of `game.ui`, `game.entities`, `game.projections`, `game.rect`, `game.render`; `files.list`, `files.read`, `files.write`, `files.readBinary`, `files.writeBinary`; `manifest()`, `onManifest`, `status()` |
| `workspacePlugin` | `gameFrame()` (`dock`, `overlay`, `box`), `show`, `active`, `device`, `devices`, `setDevice`, `onPrefs`, `overlayInGame`, `toast`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the Game panel, `run` the `editor.*` commands |

Shared modules of `panels/shared/` (R8): the scene mapping (`elementAt`, `pageFromClient`, calibration, texture catalogue), the note codec, the style edit and the token names. gameView keeps no copy of them.

gameView depends on no view, and no view depends on it (R4, D-13).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Game panel (source `game.position`). Adds the palette items: Select element, Take a screenshot, Record a series…, Overlay in game, and one `Device: <name>` per device. Binds the keys and the Esc layers. Listens to device changes. Sync, no I/O. |
| `onStart` | Starts the scene watches when Game is already active (a restored `#game` hash). |
| `onStop` | Runs the disposers and every unwatch. Clears the timers. Stops a running recording. |

| Keys (workspace keymap) | What |
|---|---|
| `mod+shift+c`, `i` | Toggle the picker. |
| `←` / `→` | Previous / next shot, in Game while the contact sheet is open. |
| `b` | Mark a shot as bug, same scope. |

Esc layers, in the workspace rank: `contactSheet`, `seriesPopover`, `captureCard`, `picker`.

## Usage

```ts
const app = createApp({
  pluginConfigs: { gameView: { capturesDir: ".moku/shots", seriesWarnShots: 100 } }
});
await app.start();
const shot = await app.gameView.capture();
```

Another view opens a contact sheet or inspects an element without depending on gameView:

```ts
ctx.emit("workspace:open-sheet", { index: ".moku/captures/series-2026-09-24-1015/index.json" });
ctx.emit("workspace:inspect", { ref: { kind: "ui", path: "boardScreen/boardSlot" } });
```

## Integration

- **renderView** emits `workspace:inspect` ("Inspect in Game") and hooks `workspace:reveal`.
- **filesView** emits `workspace:open-sheet` ("Open contact sheet") and hooks `workspace:open-file`. It previews the series `index.json` gameView writes.
- **flowView** hooks `workspace:new-note` and opens the note editor with the captures.
- **workspace** owns the overlay-in-game flag and runs `editor.overlay`. The palette item flips it.

### Scene and picker

- One `game.rect` read per session and after a device change calibrates reference units to page px.
- Without a keyed element the calibration stays `undefined`. The hint pill then says "Picker needs one keyed element", and the picker selects nothing.
- A burst of watched values rebuilds the scene once, on the next animation frame.
- A value of the wrong shape keeps the last scene and logs `gameView: scene shape`.
- The picker maps the pointer through `pageFromClient(client, gameFrame().box())` and the shared `elementAt`.

### Style card

1. The search lists `.ts`/`.tsx` files breadth-first and finds the first line with `key="k"`, `key={"k"}` or `key: "k"` that has `style={ident}`.
2. The block is the `StyleBlockRef` `{ kind: "const", name: ident }`.
3. The shared style edit looks for it in that file first. If the ident is imported from a relative module, it then looks in that module (`.ts`, `.tsx`, `/index.ts`). This is how merge-game keeps its styles.
4. Steppers exist only for fields with a `fieldRule`.
5. A burst writes once with `writeNumber`. A success toasts "✓ Saved" and reloads the game with restore (D-07).

### Captures and notes

- A series index is `{ label, durationMs, intervalMs, fromFrame, shots: [{ file, frame, atMs, bug }], device?, stoppedEarly? }`.
- Bug marks save `index.json` 400 ms after the last toggle, with its version.
- A note whose front matter the shared codec cannot read is never rewritten.

## Files

`scene/` (watch, read, manifest), `stage/` (geometry, label, reload), `capture/` (naming, shot, series, sheet), `notes/attach.ts`, `element/` (source, styles, select), `keys.ts`, `palette.ts`, `commands.ts`, `report.ts`, `view-state.ts`, and `ui/` (Preact components and `ui/styles/*.css`, one `@scope` per part, no `@layer` wrapper).

## Tests

- `__tests__/unit/`: one file per module and per component. The components run under happy-dom.
- `__tests__/integration/game-view.test.ts`: the real link, workspace, panels and gameView over an in-process hub.
- `__tests__/integration/merge-game.test.ts`: the scene, the watches and the picker over the real merge game through the agent channel. It runs only where `../game` exists.

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| No display-tree source. Picker rects are derived from `game.ui`, `game.entities`, `game.projections`. No text style card. | F-G1: display-tree source (type, bounds, texture, style key, entity per display object). |
| The viewport transform is not exposed. One `game.rect` calibration per session and device. Safe areas are guides only: the game sees insets of 0. | F-G2: `game.viewport` source and safe-area emulation. |
| The Device tab cheat rows are empty on merge-game. | F-C1: merge-game `.dev` cheats. |
