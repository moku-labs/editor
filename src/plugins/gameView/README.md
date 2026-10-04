# gameView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Game workspace (design A2): device toolbar, dotted stage with the one game frame, element picker, the Element panel with the Element and Device tabs, screenshots, series, the contact sheet and the Reference mode proxies.

What it does:

- It docks the one game frame over its stage slot with `workspace.gameFrame().dock`. The iframe never moves (R4, D-14). The dock clips the frame to the stage, less the strip the open Element panel drawer covers, so the frame never draws over the drawer.
- It draws over the game only inside its own root in `gameFrame().overlay()`.
- It watches `game.ui`, `game.entities` and `game.projections` while Game is shown (R6) or Reference mode is on (D-27). No timer reads a frame source.
- It runs every command through `ctx.require(panelsPlugin).run(id, input)` (R9). There is no `link.run` in gameView.
- It never captures on its own. Only a user action or an api call takes a screenshot or a series.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `capturesDir` | `string` | `".moku/captures"` | Folder of screenshots and series. |
| `manifestPaths` | `readonly string[]` | `["manifest.json", "public/manifest.json", "web/manifest.json"]` | Where the asset manifest may live, tried in order. |
| `captureCardMs` | `number` | `10_000` | The capture card hides after this, unless hovered or focused. Then it checks again every 2 s. |
| `seriesDurationsMs` | `readonly number[]` | `[1000, 2000, 5000, 10_000, 20_000]` | Duration chips of the series popover. |
| `seriesIntervalsMs` | `readonly number[]` | `[16, 50, 100, 250, 500, 1000]` | Interval chips of the series popover. |
| `seriesWarnShots` | `number` | `200` | The popover warns above this many planned shots. |
| `sourceSearch` | `{ maxFiles: number; skip: readonly string[] }` | `{ maxFiles: 1500, skip: ["node_modules", "dist", ".git", ".moku"] }` | Search for the source and the style block of a picked element: the folder of the game page entry first, then the root. |

`sourceSearch` is replaced as a whole: config merges shallowly. Pass both fields when you override it.

```ts
createApp({
  pluginConfigs: { gameView: { sourceSearch: { maxFiles: 3000, skip: ["node_modules", "dist", ".git", ".moku"] } } }
});
```

## API

`app.gameView` is `GameViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `pick` | `(on?: boolean) => void` | Picker on, off, or toggled. On shows Game, the Element tab and the hint pill. Off clears the hover box. |
| `selected` | `() => ElementRef \| undefined` | The picked element. |
| `select` | `(ref: ElementRef \| undefined) => void` | Selects without the picker, or clears the selection. Clears the style card. |
| `inspect` | `(ref: ElementRef) => void` | `select(ref)`, Element tab, shows Game. The `workspace:inspect` hook calls it. |
| `scene` | `() => Promise<SceneSnapshot>` | The scene from the watched sources, after a calibration in flight lands. While Game is hidden it reads the three sources once. Rejects with the link's `WireError` when no game is connected. |
| `locate` | `(ref: ElementRef) => Promise<PageRect \| undefined>` | The page rect of one element, from `scene()`. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | The pink box over the game frame. `undefined` clears it. A newer call drops an older one still waiting for the scene. |
| `manifest` | `() => Promise<TextureCatalogue \| undefined>` | The texture catalogue of the first readable `manifestPaths` entry. Cached per session. |
| `capture` | `() => Promise<CaptureFile \| undefined>` | One screenshot through `editor.capture`, written to `<capturesDir>/<yyyy-mm-dd-hhmm>-<flow>.png`. `undefined` when there is no game, no `editor.capture`, or it failed. |
| `series` | `(options: { durationMs; intervalMs; label? }) => Promise<SeriesResult \| undefined>` | One `editor.series` call. Writes `series-<stamp>/NNN.png` and `index.json`, then opens the contact sheet. Refuses while another series runs. |
| `stopSeries` | `() => void` | Runs `editor.seriesStop`. The pending series resolves with the shots taken so far. Its index gets `stoppedEarly`. |
| `openSheet` | `(indexPath: string) => Promise<void>` | Opens a saved series. Reads `index.json`, then every PNG with `readBinary`. |

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
```

Breaking (pre-1.0, Claude-pane round): `attach`, `notes` and the `notesDir` option are gone with the notes feature (D-24).

Failures never throw out of `capture`, `series` or `openSheet`.
They show a toast with the bare message (`bareMessage`, R7) and log the full one with its code.
Missing commands show "No game to capture. Connect a game first.", "The game did not add capturePlugin" or "The game did not add the overlay".

## Events

gameView declares no events. It uses the global tools events (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:reveal` | `{ ref }` | Element tab "Show in render tree". renderView hooks it. |
| Emits | `workspace:open-file` | `{ path, line }` | "Open in Files" on the style card, the call card and "Defined at". filesView hooks it. |
| Hooks | `link:status` | `{ status, session? }` | Attached again after `lost`, or a new session: drops scene, calibration and manifest. `empty`: picker off, popover closed, a series ends early. |
| Hooks | `workspace:changed` | `{ ws }` | Entering Game starts the scene watches. Leaving stops them and turns the picker off. |
| Hooks | `workspace:open-sheet` | `{ index }` | Opens that contact sheet. |
| Hooks | `workspace:inspect` | `{ ref }` | Shows Game and inspects the element. |
| Hooks | `workspace:reference` | `{ on }` | Reference mode on or off: the proxy layer in the frame overlay (D-27). |

Log events (warn): `gameView: calibration failed`, `gameView: copy reference failed`, `gameView: highlight failed`, `gameView: manifest failed`, `gameView: reload failed`, `gameView: scene shape`, `gameView: series stop failed`, `gameView: style card failed`, `gameView: style search failed`.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of the scene sources, and of `game.position` while Reference mode is on; `read` of `game.ui`, `game.entities`, `game.projections`, `game.rect`, `game.render`; `files.list`, `files.read`, `files.write`, `files.readBinary`, `files.writeBinary`; `manifest()`, `onManifest`, `status()` |
| `workspacePlugin` | `gameFrame()` (`dock`, `overlay`, `box`), `show`, `active`, `device`, `devices`, `setDevice`, `onPrefs`, `overlayInGame`, `reference`, `toast`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the Game panel, `run` the `editor.*` commands |

Shared modules of `panels/shared/` (R8): the scene mapping (`elementAt`, `isLayoutOnly`, `pageFromClient`, calibration, texture catalogue, the wire readers), the style edit, the `SidePanel` and the token names. gameView keeps no copy of them: the Reference proxies import `isLayoutOnly` from `panels/shared/scene` to put layout-only nodes under the drawing ones.

gameView depends on no view, and no view depends on it (R4, D-13).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Game panel (source `game.position`). Adds the palette items: Select element, Take a screenshot, Record a series…, Overlay in game, Show Element panel, and one `Device: <name>` per device. Binds the keys and the Esc layers. Listens to device changes. Sync, no I/O. |
| `onStart` | Starts the scene watches when Game is already active (a restored `#game` hash). Turns Reference mode on when workspace has it on. |
| `onStop` | Runs the disposers, every unwatch and the `game.position` watch. Clears the timers. Stops a running recording. |

| Keys (workspace keymap) | What |
|---|---|
| `mod+shift+c`, `i` | Toggle the picker. |
| `\` | Collapse or expand the Element panel, in Game. It shows the panel when it was closed. |
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
- **workspace** owns the overlay-in-game flag and runs `editor.overlay`. The palette item flips it.
- **workspace** owns Reference mode (`R`, the top-bar button, Esc). While it is on, the frame overlay takes the pointer and gameView draws the proxies.

### Scene and picker

- A `game.rect` read calibrates reference units to page px (finding 3).
- The target is the first keyed node that covers the ui root. Without one, it is the first keyed node with a width (the shared `calibrationTarget`).
- It reads again when the target key, its drawn rect or the root rect changes.
- After a device change it waits for the next `game.ui` snapshot, so the game has laid out at the new size first. While Game is hidden, the next `scene()` reads it.
- A read is overtaken when a `game.ui` snapshot with another target arrives while it waits. It is then discarded and read once more. The second read is kept, and a target that changed again is read next.
- Without a keyed element the calibration stays `undefined`. The hint pill then says "Picker needs one keyed element", and the picker selects nothing.
- A burst of watched values rebuilds the scene once, on the next animation frame.
- A value of the wrong shape keeps the last scene and logs `gameView: scene shape`.
- The picker maps the pointer through `pageFromClient(client, gameFrame().box())` and the shared `elementAt`.

### Style card

1. The search lists `.ts`/`.tsx` files breadth-first: the folder of the game page entry (from the manifest's page URL) first, then the root. It reads at most `maxFiles` files.
2. It looks for the key as `key="k"`, `key={"k"}`, `key: "k"`, or the same three `id` forms of a component (`<Signboard id="settingsBoard">`).
3. The style is searched from the key line to the line that closes the JSX element, eight lines at most.
4. `style={ident}`: the block is the `StyleBlockRef` `{ kind: "const", name: ident }`. The shared style edit looks for it in that file first. If the ident is imported from a relative module, it then looks in that module (`.ts`, `.tsx`, `/index.ts`). This is how merge-game keeps its styles.
5. `style={call(...)}`: a read-only card with the call, its `file:line` and "Open in Files".
6. No style in any file: "Defined at file:line" and "Open in Files", from the first file that names the key. "Source not found" only when no file names it.
7. Steppers exist only for fields with a `fieldRule`.
8. A burst writes once with `writeNumber`. A success toasts "✓ Saved" and reloads the game with restore (D-07).
9. Every search result is kept per key. The proxies and "Copy reference" read it.

The Styles list shows an object value as `key value` pairs (`top 266 · right 72 · bottom 64 · left 72`) and an array joined with `, `.

### Element panel

The side panel of the Game workspace is the shared `SidePanel` (D-29): id `game.side`, title "Element panel", docked at the end, 280 px by default (220 to 520), a drawer over the stage below 600 px of body width. While the drawer is open, the stage's clip (`[data-part="clip"]`, the frame's dock clip) ends at the drawer's edge, its resize handle included: the frame layer sits above the workspace, so the game would otherwise cover the drawer and take its clicks. It resizes, collapses to a rail and closes. While it is closed, the toolbar shows `data-action="reopen-game.side"`. The palette item "Show Element panel" shows it, `\` collapses or expands it.

### Reference mode

Game elements become referenceable from the chat (finding 17, D-27). workspace owns the flag; gameView draws the proxies.

- While on, the scene watch stays alive in every workspace, and `game.position` is watched for the flow node.
- gameView's overlay root renders `<div data-moku-proxies>` with one invisible `<div data-moku-proxy role="img">` per placed visible scene node (ui and entity), at its rect in device px. The overlay carries the frame box transform.
- Paint order is kept, a later proxy is on top. Layout-only nodes come first, under every drawing node.
- Proxies are keyed by node id, so a scene change updates them in place.
- Attributes: `aria-label="<name>"`, `title="<name> · <type>"`, `data-moku-key`, `data-moku-name`, `data-moku-type`, `data-moku-path` (ui path or `entity:<id>`), `data-moku-node` (`flow/node`), `data-moku-source` (`file:line` when a search found it), `data-moku-style` (the style identifier or call, else the nine-slice texture), `data-moku-bounds` (`x y w h`, rounded like the Element tab).
- A hover draws the picker box with its label.
- Off removes the layer, and the scene watch unless Game is shown.

The Element tab's "Copy reference" (`data-action="copy-reference"`) puts one line on the clipboard and toasts "✓ Reference copied":

```text
@moku coinPill · row · board/awaitIntent · src/hud/Hud.tsx:2 · 235,74 290×76
```

A part that is not known is left out.

### Captures

- A series index is `{ label, durationMs, intervalMs, fromFrame, shots: [{ file, frame, atMs, bug }], device?, stoppedEarly? }`.
- Bug marks save `index.json` 400 ms after the last toggle, with its version.

## Files

`scene/` (watch, calibrate, rebuild, read, manifest), `stage/` (geometry, label, reload), `capture/` (naming, shot, series, sheet), `element/` (source, styles, select), `reference/` (mode, proxies), `side.ts`, `keys.ts`, `palette.ts`, `commands.ts`, `report.ts`, `view-state.ts`, and `ui/` (Preact components and `ui/styles/*.css`, one `@scope` per part, no `@layer` wrapper).

## Tests

- `__tests__/unit/`: one file per module and per component. The components run under happy-dom.
- `__tests__/integration/game-view.test.ts`: the real link, workspace, panels and gameView over an in-process hub.
- `__tests__/integration/merge-game.test.ts`: the scene, the watches and the picker over the real merge game through the agent channel. It runs only where the pinned game checkout exists (`tests/fixtures/game-dir.ts`).

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| No display-tree source. Picker rects are derived from `game.ui`, `game.entities`, `game.projections`. No text style card. | F-G1: display-tree source (type, bounds, texture, style key, entity per display object). |
| The viewport transform is not exposed. The calibration reads `game.rect` of one keyed node. Live motion (a popup's entrance, a swing) is not modelled: the picker and the proxies use the rest pose. Safe areas are guides only: the game sees insets of 0. | F-G2: `game.viewport` source and safe-area emulation; real element bounds (release brief §1). |
| The Device tab cheat rows are empty on merge-game. | F-C1: merge-game `.dev` cheats. |
