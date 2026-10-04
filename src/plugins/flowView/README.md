# flowView

> VeryComplex plugin of the **tools** core (`createToolsPlugin`). The Flow workspace (design A1).

A Figma-like canvas of the running game on its flow graph. It shows the root frame `main`,
sub-flow frames expanded in place or entered, and the board flow as a hub with one lane per
outcome (design §7). It also draws return stubs, the trail of the last edges (the last three
2 px accent) and the current position. Sub-flows stay collapsed, except the ones holding the
current node.

Clicking a node focuses it:

- the camera moves and the rest dims; the current node never dims;
- an item holding the current node never dims either: a collapsed sub-flow, slot or hub with the
  current node inside (its key prefixes the current key, `main/board` for `main/board>board/…`),
  an expanded frame around it, or a node on the position stack. It gets the accent ring
  (`data-holds-current`) and a "here" tag, and the trail edge into it is drawn 2 px accent at full
  strength (`data-here`). A collapsed card the current node sits inside is never `data-current`:
  it holds the current node;
- the Inspector (C1–C4) shows the node, in the `flow.inspector` side panel.

The Info tab is the one place for the neighbours of a node (D-25). A click on a *Comes from* or
*Outcomes* row follows its edge (`focus.followEdge`): the other end is selected, the camera frames
both ends, a 600 ms pulse plays on the reached node, and Back (Alt+←) returns. With a selection,
← → walk, ↑ ↓ move the highlight through the rows and Enter follows it.

Nodes can be dragged. They snap to a 12-unit grid and are saved to `layoutFile`.
The Inspector reads and edits the node's code and the text styles of the game.
A save writes the file and runs the D-07 reload/restore flow.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `historyLast` | `number` | `20` | Entries of `game.history` flowView watches. |
| `trailLength` | `number` | `6` | Edges drawn as the trail, newest strongest. |
| `rejectedOutcomes` | `readonly string[]` | `["rejected"]` | Outcomes drawn as rejections. |
| `hubMinOutcomes` | `number` | `6` | Hub rule: a rest node with at least this many outcomes. |
| `hubMinReturns` | `number` | `4` | Hub rule: at least this many other nodes return to it. |
| `layoutFile` | `string` | `".moku/editor/layout.json"` | Saved positions. |
| `stylesFile` | `string \| undefined` | `undefined` | The text styles the Styles tab edits. Unset: found once per session as the first `.ts`/`.tsx` file under the link root that calls `defineTextStyles(` on a line of code (breadth-first; `node_modules`, `dist`, `.git`, `.moku` skipped; the search is `panels/shared/styles-file`, shared with gameView). |
| `layoutWorker` | `boolean` | `true` | Run ELK in a Blob Web Worker. `false` runs it inline. |
| `layoutSaveDelayMs` | `number` | `400` | Debounce of the layout save after a drop. |
| `styleSaveDelayMs` | `number` | `600` | Debounce of a style stepper burst. |
| `minZoom` | `number` | `0.08` | Lowest zoom (8 %). |
| `maxZoom` | `number` | `3` | Highest zoom (300 %). |
| `defaultMinZoom` | `number` | `0.8` | Floor of the default camera (M11). |

The node → file rule has no option here. It is `registry/protocol/source-files.ts` (R1), with its
override file `.moku/editor/files.json`. filesView uses the same rule.

## API

`app.flowView` is `FlowViewApi`: four namespaces. Every member has JSDoc and an example on its type
(`camera/types.ts`, `focus/types.ts`, `layout/types.ts`).

| Member | Signature | What |
|---|---|---|
| `camera.get` | `() => Camera` | `{ x, y, z }`: screen = world · z + (x, y). |
| `camera.fitAll` | `() => void` | Fit the root frame (F, ⇧1), leaving room for the preview and the minimap. |
| `camera.fitSelection` | `() => void` | Fit the selection and its neighbours (⇧2), else the current node. |
| `camera.zoomBy` | `(factor: number) => void` | Zoom around the viewport centre in 200 ms, inside `minZoom`–`maxZoom`. |
| `camera.zoomTo` | `(z: number) => void` | Same, to an absolute zoom. |
| `camera.follow` | `(on?: boolean) => boolean` | Toggle or set Follow the game. Only this call and the toolbar change it (M9). |
| `focus.select` | `(key: ItemKey \| NodeId \| undefined) => boolean` | Select = focus, the Inspector shows it. A bare `NodeId` expands its collapsed parents. `false` for an unknown key. `undefined` leaves focus. |
| `focus.selected` | `() => ItemKey \| undefined` | The selected item key. |
| `focus.current` | `() => NodeId \| undefined` | The node of `game.position`. |
| `focus.walk` | `(direction: "prev" \| "next") => void` | Walk from the shown node along the highlighted (else the default) *Comes from* (←) or *Outcomes* (→) row of the Info tab. |
| `focus.followEdge` | `(edgeKey: string) => boolean` | Follow an instance edge (`"main/board>board/merge:done"`) to its other end: select it, mark the edge, frame both ends, pulse, keep Back. An exit goes on through its frame's edge. `false` when the edge or its end is not drawn. |
| `focus.focusFrame` | `(frame: number) => boolean` | Focus the edge taken at a frame and mark its history row. `false` when the history has no frames. |
| `focus.step` | `() => Promise<RunResult \| undefined>` | `game.step { frames: 1 }` through `panels.run`, only while paused (M5). A failure is logged, toasted and resolves `undefined`. |
| `focus.history` | `(open?: boolean) => boolean` | Toggle or set the history strip (H). |
| `flows.expand` | `(key: ItemKey) => void` | Open a sub-flow or slot item in place. |
| `flows.collapse` | `(key: ItemKey) => void` | Fold it into one card. |
| `flows.enter` | `(key: ItemKey) => void` | Enter a sub-flow as the canvas root. |
| `flows.up` | `(depth: number) => void` | Breadcrumb back up (M1). |
| `layout.pinnedCount` | `() => number` | Pins of the visible flows. Reset layout is disabled at 0 (M8). |
| `layout.reset` | `() => Promise<void>` | Clear those pins, write `layoutFile` and toast. Rejects when nothing is pinned. |

```ts
app.flowView.focus.select("board/merge"); // true, the Inspector shows board/merge
app.flowView.focus.select("board/nope"); // false, nothing selected
app.flowView.focus.walk("next"); // focus moves to "board/awaitIntent"
app.flowView.focus.followEdge("main/board>board/awaitIntent:tap"); // true: tapGenerator selected, both ends framed
app.flowView.focus.current(); // "board/awaitIntent"
app.flowView.focus.focusFrame(1778); // true: selects edge main/board>board/merge:rejected and its row

app.flowView.camera.zoomTo(1); // 100 %
app.flowView.flows.enter("main/board"); // breadcrumb main › board
app.flowView.flows.up(0); // back to main
```

Edge keys carry the instance prefix of their ends (`EdgePath.key`), so one key names one drawn
edge even when a sub-flow shows twice. The trail and the rejections are graph facts: they match
every instance of an edge.

## Events

flowView declares no events. It uses the global tools events of `src/config.ts` (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:open-file` | `{ path, line? }` | "Open in Files" in the Code and Styles tabs, and ⇧↵ of a Nodes palette item. filesView hooks it. |
| Hooks | `link:status` | `{ status, session? }` | `silent`/`lost`: stale marking (M13). The first `live`/`paused` of a session loads `layoutFile` and the style keys. `empty`: clears the selection, the Back stack and the menu (M4), and drops an intent still waiting for the flow values. |
| Hooks | `workspace:changed` | `{ ws }` | `flow`: the default camera. Leaving Flow closes the menu and cancels the camera move. |
| Hooks | `workspace:select-node` | `{ id }` | Show Flow, then select. An unknown id logs `flowView:unknown-node`. Before the first flow values the selection waits for them. When Flow shows for the first time, the first canvas measure frames the selection, not the current node. |
| Hooks | `workspace:focus-frame` | `{ frame }` | Show Flow, then `focusFrame`. Before the first flow values it waits for them. |
| Hooks | `workspace:density` | `{ density }` | The ELK spacing follows the applied density, then a relayout. |

An intent that comes before the first `game.graph`, `game.position` and `game.history` values (Game is the default workspace, so one can come at startup) runs once they are in. Only the latest such intent is kept.

Commands run through `ctx.require(panelsPlugin).run(id, input)` (R9). That call emits `workspace:ran`.
flowView never calls `link.run` and never emits `workspace:ran` itself.

Log events use the prefix `flowView: ` (for example `flowView: layout failed`, `flowView: save failed`,
`flowView: the layout worker cannot start, ELK runs inline`), plus `flowView:unknown-node` and `flowView:overrides-invalid`.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of `game.graph`, `game.position` and `game.history { last: historyLast }` for the session; `status()`, `boot()` ("Open in editor"), `files.list`, `files.read`, `files.write`. No `run`. |
| `workspacePlugin` | `active()`, `show("flow")`, `toast`, `gameFrame().reload({ restore: true })`, `preview("flow")`, `density()`, `previewZone`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the Flow panel; `run(id, input)` for every command |

Shared modules: `panels/shared/side-panel` (the Inspector panel), `panels/shared/style-edit`
(Styles tab), `panels/shared/highlight` (Code tab), `registry/protocol` `source-files.ts`
(node → file rule).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Flow panel: no sources; commands `step: "game.step"`, `pause: "game.pause"`, `resume: "game.resume"`. Adds the palette Commands. Binds the Flow keys. Binds the Esc layers `contextMenu`, `codeEdit`, `selection`. Captures `link.files`. Takes `workspace.density()`. No I/O. |
| `onStart` | Watches `game.graph`, `game.position` and `game.history { last: historyLast }` for the whole session (R6), whatever workspace shows. The values go in once all three arrived, then one by one: the Nodes palette group, the layout, the intents of other views and the live history frames work before Flow is shown. The Flow canvas renders when Flow is first shown. Loading `layoutFile` and the style keys starts on the first `live`/`paused` status. |
| `onStop` | Waits for a pending `layoutFile` save, at most 1000 ms. Clears the timers and the camera rAF. Disposes the ELK engine (the worker is terminated, the Blob URL revoked). Removes the Nodes and Styles palette groups. Runs every remover, the three watches among them. |

Palette: Commands "Fit all", "Fit selection", "Follow the game", "Reset layout", "Go to current node", "Show where the game is", "Show Inspector".
The Nodes group is replaced when the graph hash changes. The Styles group is replaced whenever the styles file is read.

| Keys (workspace `flow`) | What |
|---|---|
| `+` `=` / `-` / `0` | Zoom in / out / 100 %. |
| `f`, `shift+1` / `shift+2` | Fit all / fit selection. |
| `h` | History strip. |
| `c` | Show where the game is: the camera moves onto the current node, with a pulse. |
| `\` | Collapse or expand the Inspector panel. |
| `←` `→` / `↑` `↓` | With a selection: walk along a *Comes from* / *Outcomes* row; move the highlight through the Info tab rows (Outcomes, then Comes from). Not while the Inspector tabs, a resize handle, a menu or a select has focus. |
| `alt+←` | Back to the selection before the last followed edge. |
| `enter` | Follow the highlighted row; on a card with keyboard focus, focus that card. A highlighted row wins over the focused card, so Enter after a walk follows the row. Other controls keep their own Enter: a button inside a frame or card (the frame's Collapse) clicks by Enter. |
| `mod+s` | Save the code edit, while editing. |
| `tab` | Moves focus card to card. A card or the hub outside the canvas pans the camera onto it. Zoom and selection stay. |

The canvas clips (`overflow: clip`) and never scrolls, so the pan above is the only way a focused item comes into view.

The pinned preview floats in the canvas, clear of the breadcrumb and toolbar band, the zoom bar and the minimap (`camera/chrome.ts`). When the float shares columns with the minimap, its bottom inset clears the minimap. That is bottom-right always, and bottom-left on a canvas too narrow for both. A tall float on a short canvas is raised only as far as it still fits under the top band.

While the Inspector floats open over the canvas as a drawer (below 600 px), the zone ends where the drawer starts, so the preview never covers it (`preview-zone.ts`, `drawerInset` in `camera/chrome.ts`). The zone is registered again on every change of the Inspector panel and every resize of the canvas, so the preview follows an open, a resize, a collapse or a close at once.

Canvas chrome: the breadcrumb ends with the current node chip and the toolbar has Show where the
game is (both run Find current, key `c`). While the current node is out of view, a chevron on the
canvas edge (`data-flow="offscreen"`) points at it. The minimap marks the current node with a
filled accent dot and draws the trail. While the Inspector panel is closed, the toolbar shows
Inspector (`data-action="reopen-flow.inspector"`).

The Inspector lives in `SidePanel id="flow.inspector" side="end"` (panels/shared/side-panel):
default width the `--inspector-w` token, 400 px while Code or Styles shows, until the person
resizes it; min 220, max 560; it floats as a drawer when the workspace is narrower than 600 px.

## Usage

```ts
const app = createApp({ pluginConfigs: { flowView: { stylesFile: "src/ui/styles.ts" } } });
await app.start();
app.flowView.focus.select("board/merge");
await app.flowView.focus.step();
```

Another view focuses Flow without depending on flowView:

```ts
ctx.emit("workspace:select-node", { id: "board/merge" });
ctx.emit("workspace:focus-frame", { frame: 1778 });
```

## Integration

- **consoleView** emits `workspace:focus-frame` from its frame links.
- **filesView** emits `workspace:select-node` from its Used-by chips, and hooks `workspace:open-file`.
- **workspace** emits `workspace:density` when the applied density changes.
- **consoleView** hooks `workspace:ran`, so a failed step is "Logged in Console".
- No view calls flowView's api (R4).

## Structure

The six module folders do not import each other (spec/15 §2.5). Types that cross modules live in
`types.ts`. Modules reach each other at run time through `env.actions()`. The root files compose them:

- `actions.ts` builds the actions of every module once per state, plus the services over link, workspace and panels;
- `watch.ts` holds the session watches and `data.ts` parses and ingests their values;
- `intents.ts` runs the intents of other views, or keeps one until the first flow values;
- `view-model.ts` computes the view data the render and inspector components get by props;
- `preview-zone.ts` makes the canvas the preview zone, clear of an open Inspector drawer, and keeps it in step with the panel and the canvas size;
- `panel.tsx` composes the components.

| Folder | What |
|---|---|
| `camera/` | Pure camera math, the chrome geometry (preview zone, focus reveal), input interpretation, the rAF tween (reduced motion jumps), the zoom bar and the minimap. Camera moves write the world transform directly and never re-render node cards. |
| `layout/` | Hub detection, the hub-lane layout and its label pass, DFS back edges, the ELK input (labels, spacing by density) and output, composition with instance keys, pins, routes, the engines. |
| `focus/` | Graph queries, the trail, walking, instance edges (`edges.ts`: the edge of an Info row, the other end of an edge). |
| `inspector/` | The node → file lookup, the Code tab controller, the styles file search, the Styles tab controller over `panels/shared/style-edit`, the tabs, the side panel size (`size.ts`). |
| `render/` | The canvas and the world components, the breadcrumb, the toolbar, the context menus, the history strip, You are here, the off-screen chevron. |

### Layout engine (elkjs)

- Every ELK edge carries its outcome label (`6.6 × length + 12` × 18 px), placed by ELK in the centre (`elk.edgeLabels.placement: CENTER`, `spacing.edgeLabel 4`, `spacing.labelNode 6`, `spacing.portPort 22`, `spacing.edgeEdge 10`, `layered.spacing.edgeEdgeBetweenLayers 10`). The canvas draws the chip at that centre (`EdgePath.labelAt`); an edge re-routed later (a pin, a frame port, a drag) falls back to its first segment's midpoint.
- A node grows tall enough for its ports (`nodeSize.constraints [PORTS, MINIMUM_SIZE]`, minimum the card or the expanded box).
- Spacing: `COL_GAP` / `NODE_SPACING` (150 / 24) without a density; comfortable 120 / 20, compact 96 / 14 (`DENSITY_SPACING`). With a density, ELK gets half the layer gap (`nodeNodeBetweenLayers` 60 comfortable, 48 compact): the centred labels take a layer of their own between two node layers, so the gap is spent twice and the flow stays as wide as before the labels.
- Hub lanes keep their own placement: the gap after the hub fits its widest outcome label, and a label pass keeps each label right of its source, moving it down by 20 until it meets no other label and no item.

- Non-hub flows run ELK in a Blob worker. The worker's text comes from `elkjs/lib/elk-worker.min.js`, imported `with { type: "text" }`, so `Bun.build` bundles it into the prebuilt tools page. `layout/elk-worker.d.ts` declares it.
- If the script does not load as text or `new Worker` throws, ELK runs inline from `elkjs/lib/elk.bundled.js`, with one warning.
- The inline engine needs a DOM. Its embedded fake worker checks `document`, so tests use happy-dom.
- Every request takes a sequence number, and a stale result is dropped. Results are cached in an LRU of 8.

### Styling

- One sheet per component: `@scope ([data-flow="…"])`, data attributes only, no class selectors, no `@layer` wrapper (R7), tokens only.
- Component tokens: `--flow-node-w`, `--flow-row`, `--flow-label-min: 11px` (M14).
- Stale data areas get `filter: saturate(0.2); opacity: 0.55`, never `backdrop-filter` (M6).
- A dimmed card, hub or stub keeps its opaque background; only its content fades, so no edge shows through. The world paints frames, lanes, heads, then the edges and their labels, then the items.
- The context menu is a `popover` (M7, D-14). It opens at the click when it fits; else it flips to end at the click; else it sits against the far canvas edge, never before 0.

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| History entries have no frame. A row shows `f<frame>` only when flowView saw it arrive live, else `#<index>`. `focusFrame` toasts "Frames are not recorded in this history" when no row has a frame. | F-H1: `frame` on history entries. |
| The graph has no file per node. The Inspector uses the shared rule; a graph node `file` wins when present. | F-H2: a dev-only `file` on graph nodes. |
| The Styles tab cannot know which text style an element uses. It preselects no card ("Pick a text style") and shows no "Used by". | F-G1 / brief §2: the game reports the text style key per ui node. |
