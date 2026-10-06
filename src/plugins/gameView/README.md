# gameView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Game workspace (design A2): device toolbar with the Sound switch, dotted stage with the one game frame, element picker, the Element panel with the Element and Device tabs (the element's code too), screenshots, series, the contact sheet, the capture card, the Reference mode proxies and area pick, the reference card and line a pick writes for the chat, and the selection it publishes for MCP (`moku_selection`, `moku_select`).

What it does:

- It docks the one game frame over its stage slot with `workspace.gameFrame().dock`. The iframe never moves (R4, D-14). The dock clips the frame to the stage, less the strip the open Element panel drawer covers, so the frame never draws over the drawer.
- It draws over the game only inside its own root in `gameFrame().overlay()`.
- It watches `game.ui`, `game.entities` and `game.projections` while Game is shown (R6) or Reference mode is on (D-27). No timer reads a frame source.
- It runs every command through `ctx.require(panelsPlugin).run(id, input)` (R9). There is no `link.run` in gameView.
- It never captures on its own. Only a user action or an api call takes a screenshot, a series or a pick.
- It knows where game code lives only from the project index (D-38, D-48): `link.files.find(key)` for the lines of a key, `link.project()` for the key map and the manifest. No file crawl, no path rule, no configured list. A key the index does not know shows `Not in the project index: <key>`; an index that is off shows `Project index is off: <reason>` (`panels/shared/project`).

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `capturesDir` | `string` | `".moku/captures"` | Folder of screenshots, series, pick shots and cards. Every capture goes into a day folder under it: `<capturesDir>/<yyyy-mm-dd>/` (local date). `.moku/captures` or a folder under it: the files sandbox writes there. |
| `captureCardMs` | `number` | `10_000` | The capture card hides after this, unless hovered or focused. Then it checks again every 2 s. |
| `seriesDurationsMs` | `readonly number[]` | `[1000, 2000, 5000, 10_000, 20_000]` | Duration chips of the series popover. |
| `seriesIntervalsMs` | `readonly number[]` | `[16, 50, 100, 250, 500, 1000]` | Interval chips of the series popover. |
| `seriesWarnShots` | `number` | `200` | The popover warns above this many planned shots. |

Any other `capturesDir` stops the app in `onInit`:

```text
[moku-editor] gameView.capturesDir must be .moku/captures or a folder under it.
  Set pluginConfigs.gameView.capturesDir to ".moku/captures/<sub>".
```

```ts
createApp({ pluginConfigs: { gameView: { captureCardMs: 5000 } } });
```

## API

`app.gameView` is `GameViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `pick` | `(on?: boolean) => void` | Picker on, off, or toggled. On shows Game, the Element tab and the hint pill. Off clears the hover box. A click that picks an element completes the pick (see "Pick for the chat"). A drag of 4 px or more picks an area instead (see "Area pick"). |
| `selected` | `() => ElementRef \| undefined` | The picked element. |
| `select` | `(ref: ElementRef \| undefined) => void` | Selects without the picker, or clears the selection. Clears the style card. Publishes the selection (see "Selection for MCP"). |
| `inspect` | `(ref: ElementRef) => void` | `select(ref)`, Element tab, shows Game. The `workspace:inspect` hook calls it. |
| `scene` | `() => Promise<SceneSnapshot>` | The scene from the watched sources, after a calibration in flight lands. While Game is hidden it reads the three sources once. Rejects with the link's `WireError` when no game is connected. |
| `locate` | `(ref: ElementRef) => Promise<PageRect \| undefined>` | The page rect of one element, from `scene()`. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | The pink box over the game frame. `undefined` clears it. A newer call drops an older one still waiting for the scene. |
| `manifest` | `() => Promise<TextureCatalogue \| undefined>` | The texture catalogue of the manifest the project index names (`ProjectState.manifest`). Cached until a new session, or a project change that names another manifest or changes it on disk. `undefined` while the index is off or names none. |
| `capture` | `() => Promise<CaptureFile \| undefined>` | One screenshot through `editor.capture`, written to `<capturesDir>/<yyyy-mm-dd>/<hhmm>-<flow>.jpg`. The extension follows the picture: `editor.capture` answers JPEG by default (D-34), an old game PNG (`.png`). Puts `shot: <path>` on the clipboard. `undefined` when there is no game, no `editor.capture`, or it failed. |
| `series` | `(options: { durationMs; intervalMs; label? }) => Promise<SeriesResult \| undefined>` | One `editor.series` call. Writes `<yyyy-mm-dd>/series-<hhmm>/NNN.png` and `index.json`, puts `series: <folder> (<n> frames)` on the clipboard, then opens the contact sheet. Refuses while another series runs. |
| `stopSeries` | `() => void` | Runs `editor.seriesStop`. The pending series resolves with the shots taken so far. Its index gets `stoppedEarly`. |
| `openSheet` | `(indexPath: string) => Promise<void>` | Opens a saved series. Reads `index.json`, then every PNG with `readBinary`. |
| `copyReference` | `() => Promise<string \| undefined>` | Writes the reference card of the selection and puts its one line on the clipboard, toast "✓ Reference copied" (see "Pick for the chat"). Returns the line, also when the clipboard refuses. `undefined` without a selection in the scene. |
| `fold` | `(inner?: boolean) => void` | Foldable presets: the cover or the inner screen, toggled without an argument (`workspace.setDevice({ folded })`). No-op for a preset without `fold`. |
| `bookmarks` | `() => readonly PickBookmark[]` | The bookmarks of the picks, newest first, at most 20: `{ id, frame, key, at, value }`. `game.restore { bookmark: value }` goes back to one. |

```ts
app.gameView.pick(true); // Game shown, picker on
app.gameView.selected(); // { kind: "ui", path: "boardScreen/hudRow/coinPill" }

const scene = await app.gameView.scene();
scene.nodes.get("ui:boardScreen/boardSlot")?.rect; // { x: 55, y: 801, w: 970, h: 970 }
await app.gameView.locate({ kind: "entity", id: 1_048_628 }); // { x: 428.5, y: 880.5, w: 223, h: 223 }

await app.gameView.capture();
// { path: ".moku/captures/2026-10-05/0846-board.jpg", frame: 1841, device: "iPhone 15 portrait", image: "data:image/jpeg;base64,…" }

await app.gameView.series({ durationMs: 2000, intervalMs: 100 });
// { folder: ".moku/captures/2026-10-05/series-1015/", indexPath: ".moku/captures/2026-10-05/series-1015/index.json", shots: 20 }

app.gameView.select({ kind: "ui", path: "settingsScreen/settingsBoard" });
await app.gameView.copyReference();
// "@moku settingsBoard panel · settingsPopup/open · features/settings/settings.tsx:290 · ref 65,190 950×1060 · .moku/captures/2026-10-05/settingsBoard-f25.md"

app.workspace.setDevice({ preset: "galaxy-z-fold-6" });
app.gameView.fold(true); // the inner screen: app.workspace.device().preset.w === 707

const [last] = app.gameView.bookmarks();
if (last) await app.panels.run("game.restore", { bookmark: last.value });
```

Breaking (pre-1.0, project index, D-38 and amendment N):

- The options `manifestPaths` and `sourceSearch` are gone. The project index names the manifest and every code location; there is no crawl and no fallback.
- A key the index does not know shows `Not in the project index: jsx:<key>` (was "Source not found for key <key>"), and its `SelectionInfo.source` is absent. An index that is off shows `Project index is off: <reason>`.
- A key built in a loop answers the line of the element that builds it, not the template literal: `card0` is `features/orders/strip.tsx:216` (was `:157 (loop)`, D-47). `(loop)` is gone from the Element tab, `data-moku-source` and the reference card.
- An area card no longer has a budget of 10 new searches (A18): every key and component is one index lookup.
- A style edit on a file the index says does not parse now is refused as `broken` (D-44): "The file does not parse now · fix it, then edit". With the index off it is refused as `index-off` (D-48): "Project index is off: <reason>".

Breaking (pre-1.0, captures by day):

- Every capture goes into a day folder `<capturesDir>/<yyyy-mm-dd>/` (local date): screenshots, pick pictures, cards, area cards and series.
- Inside the day a screenshot drops the date: `0846-board.jpg` (was `2026-10-05-0846-board.jpg`). A series folder is `series-1015/` (was `series-2026-10-05-1015/`).
- Picks and cards keep their names: `play-f1369-crop.jpg`, `f1369-full.jpg`, `play-f1369.md`, `area-f812.md`. `-2`, `-3` … count the names of that day only.
- Old flat files stay where they are.

Breaking (pre-1.0, Claude-pane round): `attach`, `notes` and the `notesDir` option are gone with the notes feature (D-24).

Breaking (pre-1.0, round 2):

- The device toolbar has no "Overlay in game" switch. The top bar and its `⋯` menu keep it.
- "Copy reference" writes the multi-line reference block, not one line. `copyReference()` returns it.
- A pick writes `<key>-f<frame>.png` and `f<frame>.png` into `capturesDir`, with `-2`, `-3` … when taken.
- `capturesDir` must be `.moku/captures` or a folder under it.

Breaking (pre-1.0, round 2b):

- "Copy reference" and a pick put one line on the clipboard, not the block. The block moves into the card file the line names. `copyReference()` returns the line.
- A pick also writes `<key>-f<frame>.md` into `capturesDir`, and shows the capture card of its shot.
- The capture card's meta line is `f<frame> · <device>` (was `frame <frame> · <device>`). A series shows the card too.
- Fit is one scale per device kind, so a small phone shows smaller than a big one.

Breaking (pre-1.0, selection round):

- A pick writes `<key>-f<frame>-crop.jpg` and `f<frame>-full.jpg` (was `<key>-f<frame>.png` and `f<frame>.png`). The crop is JPEG 0.8 (A19). The full frame keeps the type `editor.capture` answered, and its extension says which.
- A screenshot is named after its picture: `.jpg` for the JPEG `editor.capture` answers by default.

Failures never throw out of `capture`, `series` or `openSheet`.
They show a toast with the bare message (`bareMessage`, R7) and log the full one with its code.
Missing commands show "No game to capture. Connect a game first.", "The game did not add capturePlugin" or "The game did not add the overlay".

## Events

gameView declares no events. It uses the global tools events (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:reveal` | `{ ref }` | Element tab "Show in render tree". renderView hooks it. |
| Emits | `workspace:open-file` | `{ path, line }` | "Open in Files" on the style card, the call card and "Defined at". filesView hooks it. |
| Hooks | `link:status` | `{ status, session? }` | Attached again after `lost`, or a new session: drops scene, calibration and manifest. `empty`: picker off, popover closed, a series ends early. An expected reload (`isReloading`) keeps the toolbar Reload busy (U11). |
| Hooks | `link:project` | `{ state, delta }` | A new project index state (D-46). `all`: drops every key answer and style block. Else drops the answers in the changed and moved-from files, of a removed `jsx:` key, and the blocks in changed files (the kept style-call answers of the Code section too). Drops the projection answers in the changed and moved-from files, of a removed `projection:` key, and the asks still running. Reads the manifest again when it was read and the index names another or it changed. Shows the broken text on the style card while its file does not parse. Looks the selected element's style up again when its key file, style file or refusal file changed, the index had no answer, or after `all`; never during a stepper burst. |
| Hooks | `workspace:changed` | `{ ws }` | Entering Game starts the scene watches. Leaving stops them and turns the picker off. |
| Hooks | `workspace:open-sheet` | `{ index }` | Opens that contact sheet. |
| Hooks | `workspace:inspect` | `{ ref }` | Shows Game and inspects the element. |
| Hooks | `workspace:reference` | `{ on }` | Reference mode on or off: the proxy layer in the frame overlay (D-27). |

Log events (warn): `gameView: area card failed`, `gameView: calibration failed`, `gameView: copy reference failed`, `gameView: element code failed`, `gameView: highlight failed`, `gameView: manifest failed`, `gameView: mute failed`, `gameView: pick bookmark failed`, `gameView: pick crop failed`, `gameView: pick shot failed`, `gameView: projections read failed`, `gameView: reference block failed`, `gameView: reference card failed`, `gameView: reload failed`, `gameView: scene shape`, `gameView: selection publish failed`, `gameView: series stop failed`, `gameView: style card failed`, `gameView: style search failed` (the style file of an index answer cannot be loaded). `gameView: calibration failed`, `gameView: projections read failed` and `gameView: highlight failed` log at debug instead when the read failed with reason `link_closed` or `game_reloaded`, or failed with any reason while the link status is an expected reload (`isReloading`: the Hot reload switch, a server restart; e.g. -32003 before the game is back). A server restart or a game reload heals on its own (U11). Debug: `gameView: area read failed`, `gameView: clipboard refused` (the `shot:` and `series:` lines), `gameView: copy reference read failed`, `gameView: pointer capture refused`, `gameView: selection source failed`.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of the scene sources, and of `game.position` while Reference mode is on; `read` of `game.ui`, `game.entities`, `game.projections`, `game.locate` or `game.rect`, `game.render`, and for the reference block `game.position`, `game.history { last: 1 }`, `game.tainted`; `files.list`, `files.read`, `files.write`, `files.readBinary`, `files.writeBinary`, `files.find` (the project index); `project()` (the key map, the manifest, the broken files); `manifest()`, `onManifest` (the toolbar, and the sound flag on connect), `status()`, `session()`; `notify("selection", …)` and `handle("select", …)` (MCP, U4) |
| `workspacePlugin` | `gameFrame()` (`dock`, `overlay`, `box`), `show`, `active`, `device`, `devices`, `setDevice` (preset, orientation, `folded`), `onPrefs`, `overlayInGame`, `reference`, `muted`, `setMuted`, `toast`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the Game panel, `run` the `editor.*` commands, `game.bookmark` and `game.mute` |

Shared modules of `panels/shared/` (R8): the scene mapping (`elementAt`, `isLayoutOnly`, `pageFromClient`, calibration, texture catalogue, the wire readers), the style edit, the `SidePanel` and the token names. gameView keeps no copy of them: the Reference proxies import `isLayoutOnly` from `panels/shared/scene` to put layout-only nodes under the drawing ones.

gameView depends on no view, and no view depends on it (R4, D-13).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Checks `capturesDir`. Registers the Game panel (source `game.position`). Adds the palette items: Select element, Take a screenshot, Record a series…, Overlay in game, Show Element panel, and one `Device: <name>` per device. Binds the keys and the Esc layers. Listens to device changes. Handles the editor-channel request `select` with `link.handle` (MCP `moku_select`). Sync, no I/O. |
| `onStart` | Starts the scene watches when Game is already active (a restored `#game` hash). Turns Reference mode on when workspace has it on. Listens to the manifest: a game that connects while the sound is off gets `game.mute { muted: true }` (a hot reload connects a new page too). |
| `onStop` | Runs the disposers, every unwatch and the `game.position` watch. Clears the timers. Stops a running recording. |

A device change re-calibrates the picker: another preset, orientation or a fold (`folded` is part of the device identity).

| Keys (workspace keymap) | What |
|---|---|
| `mod+shift+c`, `i` | Toggle the picker. |
| `\` | Collapse or expand the Element panel, in Game. It shows the panel when it was closed. |
| `m` | Sound on or off, in Game, when the game has `game.mute`. |
| `←` / `→` | Previous / next shot, in Game while the contact sheet is open. |
| `b` | Mark a shot as bug, same scope. |

Esc layers, in the workspace rank: `contactSheet`, `seriesPopover`, `captureCard`, `picker`, `selection`. Turning the picker on hides the capture card (round 2b R17), so after "Pick another" the first Esc leaves the picker. On the `picker` layer, Esc during an area drag (Reference mode or Select) cancels the drag first; the next Esc turns the picker off. The `selection` layer comes last (U10): in the Game workspace, with the element or an area selected, Esc clears the selection (no `[data-box="selected"]`) and publishes `selection: null`, so `editor.selection` answers null. It does nothing in another workspace or while focus is in an input, a textarea or a contenteditable.

## Usage

```ts
const app = createApp({
  pluginConfigs: { gameView: { capturesDir: ".moku/captures/shots", seriesWarnShots: 100 } }
});
await app.start();
const shot = await app.gameView.capture();
```

Another view opens a contact sheet or inspects an element without depending on gameView:

```ts
ctx.emit("workspace:open-sheet", { index: ".moku/captures/2026-10-05/series-1015/index.json" });
ctx.emit("workspace:inspect", { ref: { kind: "ui", path: "boardScreen/boardSlot" } });
```

## Integration

- **renderView** emits `workspace:inspect` ("Inspect in Game") and hooks `workspace:reveal`.
- **filesView** emits `workspace:open-sheet` ("Open contact sheet") and hooks `workspace:open-file`. It previews the series `index.json` gameView writes.
- **workspace** owns the overlay-in-game flag and runs `editor.overlay`. Its top bar and the palette item flip it.
- **workspace** owns the chosen device and the docked frame's rounded clip. The presets themselves (groups, `dpr`, `radius`, `approx`, `fold`) and `resolveDevice` live in the protocol (`registry/protocol/devices.ts`), shared by both.
- **workspace** owns Reference mode (`R`, the top-bar button, Esc). While it is on, the frame overlay takes the pointer and gameView draws the proxies.

### Scene and picker

- One page rect read calibrates reference units to page px (finding 3). It reads `{ key }` from `game.locate` when the manifest lists it (game 0.4), else from `game.rect` (game 0.1).
- A manifest with neither reports no element rects: nothing is read, nothing is warned, and the hint pill says "This game reports no element rects".
- The target is the first keyed node that covers the ui root. Without one, it is the first keyed node with a width (the shared `calibrationTarget`).
- It reads again when the target key, its drawn rect or the root rect changes.
- After a device change it waits for the next `game.ui` snapshot, so the game has laid out at the new size first. While Game is hidden, the next `scene()` reads it.
- A read is overtaken when a `game.ui` snapshot with another target arrives while it waits. It is then discarded and read once more. The second read is kept, and a target that changed again is read next.
- Without a keyed element the calibration stays `undefined`. The hint pill then says "Picker needs one keyed element", and the picker selects nothing.
- A burst of watched values rebuilds the scene once, on the next animation frame.
- A value of the wrong shape keeps the last scene and logs `gameView: scene shape`.
- The picker maps the pointer through `pageFromClient(client, gameFrame().box())` and the shared `elementAt`.
- Hover uses the watched scene. A click reads `game.ui`, `game.entities` and `game.projections` once more and waits for the calibration first. The bridge sends a watched frame source at most once per heartbeat (R6), so after a screen change the watched scene can still show the screen before. The click picks from the screen the game shows now.
- A click whose read fails picks from the scene there is. A click is dropped when the picker went off while it read.
- A press that moves 4 client px or more drags an area, with the gesture of Reference mode (see "Area pick"). The release picks the area and turns the picker off, like a click pick.

### Device toolbar and stage

- The stage badge shows the link: "Paused · frame N" and "No heartbeat for N s · showing frame N" (warn), "Connecting" (info, spinner), "Game page reloaded, reconnecting · retry in N s · last frame N" (error, spinner) on a real loss. An expected reload (`isReloading`: `lost` with `reloading: true`, U9) shows "Reloading · last frame N" (info, spinner, U12) and no `data-stale` fade: the badge overlays the stage, so the layout does not move, and workspace's spinner on the game frame stays. The toolbar Reload calls `workspace.gameFrame().reload({ restore: false })`: no save, so the frame reloads at once. A style save calls it with `{ restore: true, afterSave: true, since }`, `since` taken before the write, so Bun's reload or the game's hot swap comes first. A failed reload logs `gameView: reload failed`.
- The toolbar Reload (`button[data-part="reload"]`) is busy from the click until the reload settles (resolved or failed), and while the link reports an expected reload from another trigger (`isReloading`, U11): `disabled`, `aria-busy="true"`, aria-label "Reloading", label "…". A hidden "Reload" sizer (`::after`, toolbar.css) keeps its width, so the toolbar does not shift. A click while busy starts no second reload.
- The device select has one `<optgroup>` per preset group: iPhone, Android, Foldable, Tablet, Desktop (`DEVICE_GROUPS` of the protocol).
- Each option's title has the size and dpr. An estimated preset adds "approx: estimated values".
- A foldable preset (`fold`) shows Fold / Unfold (`data-action="fold"`): "Unfold" on the cover, "Fold" on the inner screen. It calls `workspace.setDevice({ folded })`. No reload: the game sees a resize, and the picker calibrates again after the next `game.ui` snapshot.
- The bezel has a 1 px `var(--border-strong)` outline. Its inner radius is the preset's `radius` at the stage scale (`--screen-radius` on the bezel), so it matches workspace's rounded frame clip.
- Fit is one scale per device kind (round 2b R9): the scale that fits the tallest preset of the kind, its bezel included, so an iPhone SE shows smaller than a Pro Max. Foldables are phones. Tablets and the desktop have their own scale. The screen shown always fits too, so an unfolded inner screen never runs off the stage. 100 % stays 1 CSS px per px.
- The bezel follows `DeviceSpec.frame`. `modern`: 10 px all round, the island and the home bar as guides. `home-button` (iPhone SE 3): 64 px above and below the screen, 10 px at the sides, a round 44 px home button in the bottom bezel, a square screen, no island and no home bar. Landscape turns the tall bezels and the button to the sides. The bezel is in stage px, not scaled; Fit leaves room for it.
- Shot (`data-part="capture"`) and Series (`data-part="series"`) carry an icon and a label (round 2b R17). The Game workspace is the `game` inline-size container; below 1000 px the two show the icon only, 28 px square, the label visually hidden and named by `title` and `aria-label` ("Take a screenshot", "Record a series"). So a 960 px window keeps the toolbar on one row. Wider, they show the label only. A recording Series keeps its red time.
- The Sound switch (`data-part="sound"`, key M in Game, round 2b R11) runs `game.mute { muted }` through `panels.run`, then keeps the flag with `workspace.setMuted`. It is on while the game has its sound. A game without `game.mute` (before @moku-labs/game 0.4.4) dims it, title "Needs @moku-labs/game with game.mute". A refusal keeps the flag and toasts "Sound switch failed · <message>".

### Style card

1. The project index is asked `find("jsx:<key>")`; the first answer is the element (the index orders them: exact keys and `id=` props, then `{id}` patterns, then `*` patterns). `settingsBoard` is `features/settings/settings.tsx:290`, the board from line 289; `card0` is the element at `features/orders/strip.tsx:216`. The file is read right after; when it changed in between, the index is asked once more.
2. The style is the `style` attribute of the tag that opens the answer's range. A child's style is never the element's.
3. `style={ident}`: the block is the `StyleBlockRef` `{ kind: "const", name: ident }`, in the files the index defines `style:<file>#<ident>` in: the key file first, then the file the ident is imported from, then any other. The index defines none: the key file, and the shared style edit says "No style block named <ident>."
4. `style={call(...)}` (G2): when the index has a `style:<file>#<function>` key (`#<function>.<property>` for `fn(…).property`), the card is the `defineStyle({ … })` call it answers: the `StyleBlockRef` `{ kind: "call", name, line, column }` at the answer's range start, with steppers like a const block. `#<function>` answers every call of the function; the first call with an object literal is the card (`signboardStyle` answers `defineStyle(board)`, then `defineStyle({ … })`). The Code section shows that call. Without such a key, or when no call has an object to edit, the card stays read-only: the call, its `file:line` and "Open in Files".
5. No style: "Defined at file:line" and "Open in Files". A text node with a text style key (`style="ui.link"`, also `style={"ui.link"}`) is "defined at" its line too; the source keeps the key as `textStyle` for the Code section (round 2b R17).
6. The index has no answer: `Not in the project index: jsx:<key>`, or `Project index is off: <reason>`.
7. Steppers exist only for fields with a `fieldRule`.
8. A burst writes once with `writeNumber`. A file the index says does not parse now is refused as `broken`: "The file does not parse now · fix it, then edit", nothing written (D-44). An index that is off refuses as `index-off`: "Project index is off: <reason>", nothing written (D-48). A success toasts "✓ Saved" and reloads the game with restore (D-07).
9. Every answer is kept per key, and so is the place of a found style block. The proxies and the reference block read them. A `link:project` change drops the ones in the files it changed.

The Styles list shows an object value as `key value` pairs (`top 266 · right 72 · bottom 64 · left 72`) and an array joined with `, `.

### Element panel

The side panel of the Game workspace is the shared `SidePanel` (D-29): id `game.side`, title "Element panel", docked at the end, 280 px by default (220 to 520), a drawer over the stage below 600 px of body width. While the drawer is open, the stage's clip (`[data-part="clip"]`, the frame's dock clip) ends at the drawer's edge, its resize handle included: the frame layer sits above the workspace, so the game would otherwise cover the drawer and take its clicks. It resizes, collapses to a rail and closes. While it is closed, the toolbar shows `data-action="reopen-game.side"`. The palette item "Show Element panel" shows it, `\` collapses or expands it.

### Code section

The Element tab's `data-part="code"` section (round 2b R12) shows where the element is written:

- A ui element: its JSX, the lines of the range the index answered for its key (from the line that opens its tag to the line that closes it), and the `defineStyle` block of `style={ident}`, or the `defineStyle` call of a style function the index knows (G2). A text node with `style="ui.link"` shows the block of that text style key instead, titled "Style · ui.link" (round 2b R17): the lines the index answers for `textStyle:ui.link`. Each comes with `file:line`, "Open in Files" and the shared highlighter. A snippet shows 20 lines, then "Show all N lines".
- The element is the style card's index answer. A key the index does not know shows no Code section; the style card says why.
- An entity: "Spawned by <projection> · <file:line>", the index's answer for `projection:<key>` (the line of its `name: "board.items"`), or `Not in the project index: projection:<key>`; asked again on every new project state, so an entity picked before the first state or before the index knew its projection follows. Then its components with a short value (48 characters) from `game.entities`.
- It reads again when the element, its source or its style file changes.

### Reference mode

Game elements become referenceable from the chat (finding 17, D-27). workspace owns the flag; gameView draws the proxies.

- While on, the scene watch stays alive in every workspace, and `game.position` is watched for the flow node.
- gameView's overlay root renders `<div data-moku-proxies>` with one invisible `<div data-moku-proxy role="img">` per placed visible scene node (ui and entity), at its rect in device px. The overlay carries the frame box transform.
- Paint order is kept, a later proxy is on top. Layout-only nodes come first, under every drawing node.
- Proxies are keyed by node id, so a scene change updates them in place.
- Attributes: `aria-label="<name>"`, `title="<name> · <type>"`, `data-moku-key`, `data-moku-name`, `data-moku-type`, `data-moku-path` (ui path or `entity:<id>`), `data-moku-node` (`flow/node`), `data-moku-source` (`file:line` when the index answered the key), `data-moku-style` (the style identifier or call, else the nine-slice texture), `data-moku-style-source` (`file:line` of the style block or the call), `data-moku-bounds` (`x y w h`, rounded like the Element tab), `data-moku-ref-bounds` (`x y w h` in reference units), `data-moku-frame` (the scene frame).
- A hover draws the picker box with its label.
- A click (`pointerup`) picks the proxy's node (see below), in any workspace.
- The cursor is a crosshair over the whole layer and every proxy. The layer takes the pointer too, so a press anywhere over the game can drag an area (see "Area pick").
- Off removes the layer, and the scene watch unless Game is shown.

### Pick for the chat

A completed pick (a picker click, a click on a Reference proxy, or MCP `moku_select`) does, in order:

1. `game.bookmark` through `panels.run`. The bookmark is kept: `bookmarks()`, newest first, at most 20. Its id is `<key>-f<frame>`, with `-2` … when a kept one has it.
2. `editor.capture` through `panels.run` (the capture plugin accepts both `game.capture` answers: a string, or `{ png }`). It answers JPEG by default (D-34).
3. The crop: the element's rect plus 8 px, cut from the picture with a canvas in the tools page and encoded JPEG 0.8 (A19). The box is scaled by picture width / device width, the shot's real pixel ratio. Only a calibrated scene is cropped.
4. Both files through `files.writeBinary` into today's folder `<capturesDir>/<yyyy-mm-dd>/`: `<key>-f<frame>-crop.jpg` (crop) and `f<frame>-full.jpg` (full frame), `-2`, `-3` … before the suffix when taken. Each extension follows its picture: a PNG stays `.png`. An entity uses its node name for `<key>`.
5. The card file `<key>-f<frame>.md` beside the full frame, `-2`, `-3` … when taken (round 2b R13). Without pictures it goes into today's folder. The card links its pictures by file name, so "Copy reference" of a pick from another day writes the card into that day's folder: the full reference block, the JSX and style snippets fenced with their `file:line` (an entity: its projection and components), and `![element](<key>-f<frame>-crop.jpg)` `![frame](f<frame>-full.jpg)`.
6. One line on the clipboard, toast "Reference, shot and bookmark copied":

```text
@moku <name> <type> · <flow/node> · <file:line> · ref x,y w×h · <card path>
```

7. The capture card of the shot: the crop, Copy link, Open, and Reference (copies the line again).
8. The selection is published again with its `card`, `crop`, `line` and the frame of the pick, while the node is still selected (see "Selection for MCP").

`completePick(ctx, node, scene, { copy })` returns `{ block, line, card, crop, full, frame, info }` (A8). MCP `moku_select` passes `copy: false`: no clipboard, no toast, the capture card still shows.

A game without `game.bookmark` or `editor.capture`, or a step that fails, leaves its lines out. The toast then names only what was copied: "Reference and shot copied", "Reference and bookmark copied", "Reference copied". A card that cannot be written leaves its path out of the line and logs `gameView: reference card failed`.

"Copy reference" writes the card of the selection and copies its line. The same node and frame write the same card again, so pressing Copy twice keeps one file.

The reference block in the card, fixed order. A line or a field that is not known is left out:

```text
@moku <name> · <type> · <flow/node> · f<frame>
path: <ui path> | entity #<id> (<components, max 5>)
source: <file:line> · style: <identifier> <file:line> · texture: <nineSlice/texture>
layout: <parent chain, nearest first, max 3: key (direction, padding, margin, gap)>
bounds: <x>,<y> <w>×<h> px · ref <x>,<y> <w>×<h>
state: <visible|hidden>, <is-flags> · value "<text>" · alpha <a>
flow: <position stack joined by " > "> · last: <from> → <outcome> (f<frame>)
game: <name> <version> · <session> · f<frame> · <HH:MM:SS> · <paused|live> · <tainted|clean>
device: <preset> <w>×<h> <orientation> · dpr <n> · safe <t>/<r>/<b>/<l>
restore: bookmark <id>
shot: <crop path> · frame: <full path>
```

- `ref` is `SceneNode.refRect`: the rect in the game's reference units.
- `layout` reads the styles of the ui parents. Padding and margin print as `t/r/b/l`. The parents are joined with ` < `.
- `state` flags are `pressed`, `disabled`, `selected` when true, from the style or the node's `state` in `game.ui`.
- `value` and `text:` wait for the game to report them (brief §2).
- `last` is the newest `game.history` entry. Its frame only when the game reports one.
- `restore` and `shot` belong to the last pick of this element.

On merge-game, the settings board after a pick:

```text
@moku settingsBoard · panel · settingsPopup/open · f25
path: settingsScreen/settingsBoard
source: features/settings/settings.tsx:290 · texture: ui.panel-signboard
layout: settingsScreen (column, padding 0/0/0/0)
bounds: 65,190 950×1060 px · ref 65,190 950×1060
state: visible
flow: board > settings > open · last: board/settings/enter → done
game: merge-game 0.0.0 · s-7e63 · f25 · 17:16:39 · live · clean
device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0
restore: bookmark settingsBoard-f25
shot: .moku/captures/2026-10-05/settingsBoard-f25-crop.jpg · frame: .moku/captures/2026-10-05/f25-full.jpg
```

The Element tab shows the full block in a read-only `<pre data-part="reference">`. Its Copy button (`data-action="copy-reference"`) runs `copyReference()`: the card, and the one line on the clipboard. The block is gathered again when the element, its source, its style block, its bounds, the flow node or the last pick changes.

### Area pick

In Reference mode a press on the proxy layer that moves 4 client px or more drags an area (U9, A16). The Select picker layer has the same gesture: both layers spread the one `layerHandlers(ctx, onClick)` (`ui/layer-handlers.ts`).

- The press takes nothing. Under 4 px the release is a click: the proxy under it picks as before, or the picker picks the element at the point (`pickAt`).
- From 4 px the layer holds the pointer (pointer capture), the hover box freezes and a dashed marquee `<div data-box="area">` follows the pointer. Its rect is `state.reference.area`, device px through `pageFromClient(client, gameFrame().box())`.
- The release reads the scene once more and picks the area (`pickDraggedArea`). In Select the picker turns off, like a click pick. Esc during the drag cancels it: the release then picks nothing.

The group of the area:

- The visible placed nodes that lie fully inside it. With none, the nodes it covers by at least half of their own area.
- A node whose ancestor is in the group is dropped: a row inside the area travels with its pill and its icon.
- Top to bottom, then left to right. At most 40; the card says `+N more`.
- An uncalibrated scene has no group: its rects are not device px.

Then the pick path with the area: `game.bookmark` (`area-f<frame>`), `editor.capture`, the crop of the area plus 8 px (`area-f<frame>-crop.jpg`), the full frame, and the card `<capturesDir>/<yyyy-mm-dd>/area-f<frame>.md`:

```text
@moku area <w>×<h> · <flow/node> · <N> elements · ref x,y w×h · <card path>
- <name> <type> · key <key> · text "…" · <file:line> · x,y w×h px · ref x,y w×h
  - <name> <type> · key <key> · text "…" · x,y w×h px
    - …
  +<N> more
+<N> more
layout: <root>, <root> < <parent> (row, gap 18) < <grandparent> …
partly in the area: <name> <type> x,y w×h px · …
flow: … · game: … · device: … · restore: … · shot: …
```

- The head is the line the clipboard gets. `ref` is the area in reference units, only when the scene is calibrated. An empty area says `no elements`.
- One line per element. `x,y w×h px` is the bounds in game page CSS px, like a single element's `bounds:`.
- Under each element its child tree (captures-by-day U5): the visible descendants, two spaces per level, 3 levels at most, 60 lines in the whole tree. A root the cap cut ends with `+N more`.
- `text "…"`: the `content` the game reports for the node, trimmed, 40 characters at most. A node on the last tree level shows the first text under it, so a badge count is not lost.
- One `layout:` line per parent chain of the elements: the elements that share it, then up to 3 parents in the form of a single element's `layout:`.
- `partly in the area:` the nodes that overlap the area but are not inside it, largest overlap first, at most 8. A node of an element's tree and a parent a layout line names are left out. A background is named here.
- Then the tail lines of a single element's block (`tailLines`).
- The card adds the JSX and style snippets of every element with a source, each titled with its element. A known source is not asked again.
- An element or a child that is a component instance (`<RoundButton id="homeSettings" …>`: the tag that opens its index range) adds `## <key> · component <Name> · <file:line>` with the component's definition, once per component: the index's answer for `component:<Name>` (G1), 60 lines at most. A component the index does not know is left out.
- Then `![area](…)` `![frame](…)`.
- Sources come from the project index, one lookup per key not known yet. `SelectionInfo.items` is unchanged: the children are card text only.
- The capture card shows like a pick. The single selection is cleared.

### Selection for MCP

The editor page publishes its selection to the hub (U4, D-33) with `link.notify("selection", info)`. MCP `moku_selection` reads it.

- Every change of the selection publishes: a picker click, a proxy click, `select`, `inspect`, a tree row. `select(undefined)` publishes null.
- The info (`SelectionInfo` of the protocol): `ref`, `key`, `projection`, `name`, `type`, `rect` (page CSS px), `source` (`file:line` of the key), `session`, `frame`, `at`. Unknown fields are left out.
- `projection`: an entity's owner. A ui node: the projection of `game.projections` that holds its key (and its root key when two hold it).
- A key the index has not answered yet is published without `source` first, then again with it. A key the index does not know stays without `source`. A newer selection drops the late one.
- After a pick: `card`, `crop`, `line` and the frame of the pick. An area: `type: "area"`, `name: "area"`, `rect` and `area` the area, `items` the group, `ref` the first item's (`{ kind: "ui", path: "" }` when empty). First without sources, then with them and the files.

MCP `moku_select` reaches gameView as the editor-channel request `select` (`link.handle("select", …)`, added in `onInit`):

- `rect` wins over `key` and `ref`: the area pick above, without the clipboard. Game is shown.
- `key`: the first ui node with that key on a fresh scene. `"hud/infoBar"` names the key `infoBar` in the projection `hud`.
- `ref`: the node of that ref.
- The element is inspected (Game workspace, Element tab), then picked like a click with `copy: false` unless `card` is false. The answer is its `SelectionInfo`.
- Not found: -32602 `invalid_input`, "No element with key <key>" (or "… with ref <id>"). The empty ui ref of an empty area: "area selection has no element". Neither key, ref nor rect: "editor.select needs a key, a ref or a rect".
- No game: the link's error passes.

### Captures

- The capture card (`[data-game="card"]`, round 2b R14) is a grid `56px minmax(0, 1fr) auto`: the thumbnail, then one line each for the title ("✓ Screenshot saved", "✓ 20 shots saved"), the path cut in the middle (36 characters, the whole path in `title`) and `f<frame> · <device>`, then the actions, and × on the right. At most 360 px wide and 120 px tall; at 480 px of window it takes the width less 24.
- Actions: "Copy link" (`shot: <path>`, or `series: <folder> (<n> frames)`), "Open" (the picture in Files, or the series' contact sheet) and, after a pick, "Reference" (the reference line).
- A screenshot, a pick and a series each show the card. It hides after `captureCardMs` unless hovered or focused.
- A series index is `{ label, durationMs, intervalMs, fromFrame, shots: [{ file, frame, atMs, bug }], device?, stoppedEarly? }`.
- Bug marks save `index.json` 400 ms after the last toggle, with its version.

## Files

`scene/` (watch, calibrate, rebuild, read, manifest), `stage/` (geometry, label, reload, fold), `capture/` (naming, shot, series, sheet, crop), `element/` (source, styles, select, selection, publish, select-request, jsx, code, spawn, text-styles, project), `reference/` (mode, proxies, gesture, area, area-block, block, facts, card, pick), `side.ts`, `keys.ts`, `palette.ts`, `commands.ts`, `clipboard.ts`, `sound.ts`, `report.ts`, `view-state.ts`, and `ui/` (Preact components and `ui/styles/*.css`, one `@scope` per part, no `@layer` wrapper).

## Tests

- `__tests__/unit/`: one file per module and per component. The components run under happy-dom.
- `__tests__/integration/game-view.test.ts`: the real link, workspace, panels and gameView over an in-process hub.
- `__tests__/integration/merge-game.test.ts`: the scene, the watches and the picker over the real merge game through the agent channel. It runs only when `MOKU_GAME_DIR` names a game checkout (`tests/fixtures/game-dir.ts`).
- `__tests__/unit/source.test.ts` also opens the project index of the merge game when the checkout exists: `settingsBoard` answers `settings.tsx:290` (range from 289) and `card0` answers the element at `strip.tsx:216` with its style call at 218. `jsx.test.ts` reads that style attribute there too. The other unit tests script `files.find` and `link.project()` (`answer`, `place`, `projectOn` in `__tests__/helpers.ts`).
- `tests/integration/pick-reference.test.ts` (root): a proxy pick on the merge-game settings popup writes both PNGs and the card `.md`, copies the one reference line that names the card, the card's `text` fence holds every line of the block and links both PNGs, and its bookmark restores the popup. Local only, like the merge journeys.

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| No display-tree source. Picker rects are derived from `game.ui`, `game.entities`, `game.projections`. No text style card. | F-G1: display-tree source (type, bounds, texture, style key, entity per display object). |
| The viewport transform is not exposed. The calibration reads `game.locate` (or `game.rect`) of one keyed node. Live motion (a popup's entrance, a swing) is not modelled: the picker and the proxies use the rest pose. Safe areas are guides only: the game sees insets of 0. | F-G2: `game.viewport` source and safe-area emulation; real element bounds (release brief §1). |
| The Device tab cheat rows are empty on merge-game. | F-C1: merge-game `.dev` cheats. |
