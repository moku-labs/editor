# flowView

> VeryComplex plugin of the **tools** core (`createToolsPlugin`). The Flow workspace (design A1).

A Figma-like canvas of the running game on its flow graph. It shows the root frame `main`,
sub-flow frames expanded in place or entered, and the board flow as a hub with one lane per
outcome (design §7). It also draws return stubs, notes, the trail of the last edges and the
current position.

Clicking a node focuses it:

- the camera moves and the rest dims;
- the Inspector (C1–C5) shows the node;
- the neighbours strip (C6) opens with *Comes from · This node · Goes to*.

Nodes and notes can be dragged. They snap to a 12-unit grid and are saved to `layoutFile`.
Notes are Markdown files in `notesDir`. The Inspector reads and edits the node's code and the text styles of its scene.
A save writes the file and runs the D-07 reload/restore flow.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `historyLast` | `number` | `20` | Entries of `game.history` the panel watches. |
| `trailLength` | `number` | `6` | Edges drawn as the trail, newest strongest. |
| `rejectedOutcomes` | `readonly string[]` | `["rejected"]` | Outcomes drawn as rejections. |
| `hubMinOutcomes` | `number` | `6` | Hub rule: a rest node with at least this many outcomes. |
| `hubMinReturns` | `number` | `4` | Hub rule: at least this many other nodes return to it. |
| `layoutFile` | `string` | `".moku/editor/layout.json"` | Saved positions. |
| `notesDir` | `string` | `".moku/notes"` | Note files. |
| `stylesFile` | `string` | `"features/ui/styles.ts"` | The text styles the Styles tab edits. |
| `layoutWorker` | `boolean` | `true` | Run ELK in a Blob Web Worker. `false` runs it inline. |
| `layoutSaveDelayMs` | `number` | `400` | Debounce of the layout save after a drop. |
| `styleSaveDelayMs` | `number` | `600` | Debounce of a style stepper burst. |
| `minZoom` | `number` | `0.08` | Lowest zoom (8 %). |
| `maxZoom` | `number` | `3` | Highest zoom (300 %). |
| `defaultMinZoom` | `number` | `0.8` | Floor of the default camera (M11). |

The node → file rule has no option here. It is `registry/protocol/source-files.ts` (R1), with its
override file `.moku/editor/files.json`. filesView uses the same rule.

## API

`app.flowView` is `FlowViewApi`: five namespaces. Every member has JSDoc and an example on its type
(`camera/types.ts`, `focus/types.ts`, `layout/types.ts`, `notes/types.ts`).

| Member | Signature | What |
|---|---|---|
| `camera.get` | `() => Camera` | `{ x, y, z }`: screen = world · z + (x, y). |
| `camera.fitAll` | `() => void` | Fit the root frame (F, ⇧1), leaving room for the preview and the minimap. |
| `camera.fitSelection` | `() => void` | Fit the selection and its neighbours (⇧2), else the current node. |
| `camera.zoomBy` | `(factor: number) => void` | Zoom around the viewport centre in 200 ms, inside `minZoom`–`maxZoom`. |
| `camera.zoomTo` | `(z: number) => void` | Same, to an absolute zoom. |
| `camera.follow` | `(on?: boolean) => boolean` | Toggle or set Follow the game. Only this call and the toolbar change it (M9). |
| `focus.select` | `(key: ItemKey \| NodeId \| undefined) => boolean` | Select = focus, the strip opens. A bare `NodeId` expands its collapsed parents. `false` for an unknown key. `undefined` leaves focus. |
| `focus.selected` | `() => ItemKey \| undefined` | The selected item key. |
| `focus.current` | `() => NodeId \| undefined` | The node of `game.position`. |
| `focus.walk` | `(direction: "prev" \| "next") => void` | Walk through the strip (← →). |
| `focus.focusFrame` | `(frame: number) => boolean` | Focus the edge taken at a frame and mark its history row. `false` when the history has no frames. |
| `focus.step` | `() => Promise<RunResult \| undefined>` | `game.step { frames: 1 }` through `panels.run`, only while paused (M5). A failure is logged, toasted and resolves `undefined`. |
| `focus.history` | `(open?: boolean) => boolean` | Toggle or set the history strip (H). |
| `flows.expand` | `(key: ItemKey) => void` | Open a sub-flow or slot item in place. |
| `flows.collapse` | `(key: ItemKey) => void` | Fold it into one card. |
| `flows.enter` | `(key: ItemKey) => void` | Enter a sub-flow as the canvas root. |
| `flows.up` | `(depth: number) => void` | Breadcrumb back up (M1). |
| `layout.pinnedCount` | `() => number` | Pins of the visible flows. Reset layout is disabled at 0 (M8). |
| `layout.reset` | `() => Promise<void>` | Clear those pins, write `layoutFile` and toast. Rejects when nothing is pinned. |
| `notes.list` | `() => readonly NoteFile[]` | Parsed note files, newest first. |
| `notes.edit` | `(draft?: Partial<NoteDraft>) => void` | Open the note editor (D5). |
| `notes.create` | `(input: NoteInput) => Promise<NoteFile>` | Write `<notesDir>/<date>-<slug>.md` with the contract front matter. Toasts "✓ Note saved · <path>" (M12). |
| `notes.attach` | `(path: string, captures: readonly string[]) => Promise<NoteFile>` | Append capture paths (version checked, one retry). Toasts "✓ Attached to <title>". |

```ts
app.flowView.focus.select("board/merge"); // true, the strip opens
app.flowView.focus.select("board/nope"); // false, nothing selected
app.flowView.focus.walk("next"); // focus moves to "board/awaitIntent"
app.flowView.focus.current(); // "board/awaitIntent"
app.flowView.focus.focusFrame(1778); // true: selects edge board/merge:rejected and its row

app.flowView.camera.zoomTo(1); // 100 %
app.flowView.flows.enter("main/board"); // breadcrumb main › board
app.flowView.flows.up(0); // back to main

await app.flowView.notes.create({
  title: "First wood 4",
  body: "…",
  from: { node: "board/merge", outcome: "done" }
});
// { path: ".moku/notes/2026-09-24-first-wood-4.md", note: { status: "idea", to: "board/awaitIntent", … } }
```

## Events

flowView declares no events. It uses the global tools events of `src/config.ts` (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:open-file` | `{ path, line? }` | "Open in Files" in the Code, Styles and Notes tabs, and ⇧↵ of a Nodes palette item. filesView hooks it. |
| Hooks | `link:status` | `{ status, session }` | `silent`/`lost`: stale marking (M13). The first `live`/`paused` of a session loads `layoutFile`, the notes and the style keys. `empty`: clears the selection, the strip, the menus and the editor (M4). |
| Hooks | `workspace:changed` | `{ ws }` | `flow`: the default camera. Leaving Flow closes the menu and cancels the camera move. |
| Hooks | `workspace:select-node` | `{ id }` | Show Flow, then select. An unknown id logs `flowView:unknown-node`. |
| Hooks | `workspace:focus-frame` | `{ frame }` | Show Flow, then `focusFrame`. |
| Hooks | `workspace:new-note` | `{ captures?, from? }` | Show Flow, then open D5 with the captures and the origin. |

Commands run through `ctx.require(panelsPlugin).run(id, input)` (R9). That call emits `workspace:ran`.
flowView never calls `link.run` and never emits `workspace:ran` itself.

Log events use the prefix `flowView: ` (for example `flowView: layout failed`, `flowView: save failed`,
`flowView: the layout worker cannot start, ELK runs inline`), plus `flowView:unknown-node` and `flowView:overrides-invalid`.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `status()`, `read("game.ui")` (Styles "Used by", one shot), `boot()` ("Open in editor"), `files.list`, `files.read`, `files.write`, `files.readBinary`. No `run`. |
| `workspacePlugin` | `active()`, `show("flow")`, `toast`, `gameFrame().reload({ restore: true })`, `preview("flow")`, `previewZone`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the Flow panel; `run(id, input)` for every command |

Shared modules: `panels/shared/notes` (note codec), `panels/shared/style-edit` (Styles tab),
`panels/shared/highlight` (Code tab), `registry/protocol` `source-files.ts` (node → file rule).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Flow panel: sources `game.graph`, `game.position`, `game.history { last: historyLast }`; commands `step: "game.step"`, `pause: "game.pause"`, `resume: "game.resume"`. Adds the palette Commands. Binds the Flow keys. Binds the Esc layers `contextMenu`, `noteEditor`, `codeEdit`, `selection`. Captures `link.files`. No I/O. |
| `onStart` | None. Loading starts on the first `live`/`paused` status. |
| `onStop` | Waits for a pending `layoutFile` save, at most 1000 ms. Clears the timers and the camera rAF. Disposes the ELK engine (the worker is terminated, the Blob URL revoked). Removes the Nodes and Styles palette groups. Runs every remover. |

Palette: Commands "Fit all", "Fit selection", "Follow the game", "Reset layout", "Add a note", "Go to current node".
The Nodes group is replaced when the graph hash changes. The Styles group is replaced whenever `stylesFile` is read.

| Keys (workspace `flow`) | What |
|---|---|
| `+` `=` / `-` / `0` | Zoom in / out / 100 %. |
| `f`, `shift+1` / `shift+2` | Fit all / fit selection. |
| `n` / `h` | New note / history strip. |
| `←` `→` `↑` `↓` | Walk and move the highlight, while the strip is open. |
| `enter` | Focus the card that has keyboard focus. |
| `mod+s` | Save the code edit or the note, while editing. |

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
- **gameView** emits `workspace:new-note` with captures.
- **consoleView** hooks `workspace:ran`, so a failed step is "Logged in Console".
- No view calls flowView's api (R4).

## Structure

The six module folders do not import each other (spec/15 §2.5). Types that cross modules live in
`types.ts`. Modules reach each other at run time through `env.actions()`. The root files compose them:

- `actions.ts` builds the actions of every module once per state, plus the services over link, workspace and panels;
- `view-model.ts` computes the view data the render and inspector components get by props;
- `panel.tsx` composes the components.

| Folder | What |
|---|---|
| `camera/` | Pure camera math, input interpretation, the rAF tween (reduced motion jumps), the zoom bar and the minimap. Camera moves write the world transform directly and never re-render node cards. |
| `layout/` | Hub detection, the hub-lane layout, DFS back edges, the ELK input and output, composition with instance keys, pins, routes, the engines. |
| `focus/` | Graph queries, the trail, walking, the neighbours strip. |
| `notes/` | Slugs, the note actions over the shared codec `panels/shared/notes`, the note editor. |
| `inspector/` | The node → file lookup, the Code tab controller, the Styles tab controller over `panels/shared/style-edit`, the tabs. |
| `render/` | The canvas and the world components, the breadcrumb, the toolbar, the context menus, the history strip, You are here. |

### Layout engine (elkjs)

- Non-hub flows run ELK in a Blob worker. The worker's text comes from `elkjs/lib/elk-worker.min.js`, imported `with { type: "text" }`, so `Bun.build` bundles it into the prebuilt tools page. `layout/elk-worker.d.ts` declares it.
- If the script does not load as text or `new Worker` throws, ELK runs inline from `elkjs/lib/elk.bundled.js`, with one warning.
- The inline engine needs a DOM. Its embedded fake worker checks `document`, so tests use happy-dom.
- Every request takes a sequence number, and a stale result is dropped. Results are cached in an LRU of 8.

### Styling

- One sheet per component: `@scope ([data-flow="…"])`, data attributes only, no class selectors, no `@layer` wrapper (R7), tokens only.
- Component tokens: `--flow-node-w`, `--flow-row`, `--flow-label-min: 11px` (M14), `--flow-strip-h`.
- Stale data areas get `filter: saturate(0.2); opacity: 0.55`, never `backdrop-filter` (M6).
- The note editor is a modal `<dialog>` and the context menu a `popover` (M7, D-14).

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| History entries have no frame. A row shows `f<frame>` only when flowView saw it arrive live, else `#<index>`. `focusFrame` toasts "Frames are not recorded in this history" when no row has a frame. | F-H1: `frame` on history entries. |
| The graph has no file per node. The Inspector uses the shared rule; a graph node `file` wins when present. | F-H2: a dev-only `file` on graph nodes. |
| Styles "Used by" needs style keys in `game.ui`. Until then the row reads "Used by appears when the game reports style keys". | F-G1: a display-tree source with style keys. |
