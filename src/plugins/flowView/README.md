# flowView

> VeryComplex plugin (tools core). The Flow workspace (design A1).

A Figma-like canvas of the running game on its flow graph. It shows the root frame `main`,
sub-flow frames expanded in place or entered, and the board flow as a hub with one lane per
outcome (design §7). It also draws return stubs, notes, the trail of the last edges and the
current position.

Clicking a node focuses it:

- the camera moves and the rest dims;
- the Inspector (C1–C5) shows the node;
- the neighbours strip (C6) opens with *Comes from · This node · Goes to*.

Nodes and notes can be dragged. They snap to a 12-unit grid and are saved to
`.moku/editor/layout.json`. Notes are Markdown files in `.moku/notes/`. The Inspector reads and
edits the node's code and the text styles of its scene. A save writes the file and runs the D-07
reload/restore flow.

## API

`app.flowView` has five namespaces. Every member has JSDoc and an example on its type.

| Member | What |
|---|---|
| `camera.get()` | The camera `{ x, y, z }`: screen = world · z + (x, y). |
| `camera.fitAll()` | Fit the root frame (F, ⇧1), leaving room for the preview and the minimap. |
| `camera.fitSelection()` | Fit the selection and its neighbours (⇧2), else the current node. |
| `camera.zoomBy(f)` / `camera.zoomTo(z)` | Zoom around the viewport centre in 200 ms. The range is 8 %–300 %. |
| `camera.follow(on?)` | Toggle or set Follow the game. Only this call and the toolbar change it (M9). |
| `focus.select(key)` | Select = focus. A bare `NodeId` expands its collapsed parents. `false` for an unknown key. |
| `focus.selected()` / `focus.current()` | The selected item key, and the node of `game.position`. |
| `focus.walk("prev" \| "next")` | Walk through the strip (← →). |
| `focus.focusFrame(n)` | Focus the edge taken at a frame and mark its history row. `false` when the history has no frames (until F-H1). |
| `focus.step()` | `game.step { frames: 1 }` through `panels.run`, only while paused (M5). |
| `focus.history(open?)` | Toggle the history strip (H). |
| `flows.expand/collapse(key)` | Open or fold a sub-flow or slot item in place. |
| `flows.enter(key)` / `flows.up(depth)` | Enter a sub-flow as the canvas root. The breadcrumb goes back up (M1). |
| `layout.pinnedCount()` | Pins of the visible flows. Reset layout is disabled at 0 (M8). |
| `layout.reset()` | Clear those pins, write `layout.json` and toast. Rejects when nothing is pinned. |
| `notes.list()` | Parsed note files, newest first. |
| `notes.edit(draft?)` | Open the note editor (D5). |
| `notes.create(input)` | Write `<notesDir>/<date>-<slug>.md` with the contract front matter and toast. |
| `notes.attach(path, captures)` | Append capture paths (version checked, one retry) and toast. |

```ts
const tools = createApp({});
await tools.start();
tools.flowView.focus.select("board/merge"); // true, the strip opens
await tools.flowView.notes.create({ title: "First wood 4", from: { node: "board/merge", outcome: "done" } });
```

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `historyLast` | `20` | Entries of `game.history` the panel watches. |
| `trailLength` | `6` | Edges drawn as the trail, newest strongest. |
| `rejectedOutcomes` | `["rejected"]` | Outcomes drawn as rejections. |
| `hubMinOutcomes` / `hubMinReturns` | `6` / `4` | Hub rule thresholds (design §7.1). |
| `layoutFile` | `".moku/editor/layout.json"` | Saved positions. |
| `notesDir` | `".moku/notes"` | Note files. |
| `stylesFile` | `"features/ui/styles.ts"` | The text styles the Styles tab edits. |
| `layoutWorker` | `true` | Run ELK in a Blob Web Worker. `false` runs it inline. |
| `layoutSaveDelayMs` / `styleSaveDelayMs` | `400` / `600` | Debounce of the layout save and of a stepper burst. |
| `minZoom` / `maxZoom` / `defaultMinZoom` | `0.08` / `3` / `0.8` | Zoom range and the floor of the default camera (M11). |

```ts
createApp({ pluginConfigs: { flowView: { stylesFile: "src/ui/styles.ts" } } });
```

The node → file rule has no option here. It is `registry/protocol/source-files.ts` (R1), with its
override file `.moku/editor/files.json`.

## Events

- **Declares** no events.
- **Emits** the global `workspace:open-file { path, line? }`. Its sources are "Open in Files" in
  the Code, Styles and Notes tabs, and ⇧↵ of a Nodes palette item.
- **Hooks** five global events:
  - `link:status`: stale marking (M13). The first live status of a session loads `layout.json`,
    the notes and the style keys. `empty` clears the selection, the strip, the menus and the editor
    (M4).
  - `workspace:changed`: the default camera once per root. Leaving Flow closes the menu.
  - `workspace:select-node`: show Flow, then select. An unknown id logs
    `flowView:unknown-node`.
  - `workspace:focus-frame`: show Flow, then `focusFrame`.
  - `workspace:new-note`: show Flow, then open D5 with the captures and the origin.
- **Commands** run through `ctx.require(panelsPlugin).run(id, input)` (R9). That call emits
  `workspace:ran`. flowView never calls `link.run`.

## Lifecycle

- **onInit**:
  - registers the Flow panel: `game.graph`, `game.position`, `game.history {last}`, and the
    commands `step`, `pause`, `resume`;
  - adds the palette Commands;
  - binds the Flow keys with `workspace: "flow"`;
  - binds the Esc layers `contextMenu`, `noteEditor`, `codeEdit`, `selection`;
  - keeps every remover and captures `link.files`. No I/O.
- The Nodes palette group is replaced when the graph hash changes. The Styles group is replaced
  whenever `stylesFile` is read.
- **onStop**:
  - waits for a pending `layout.json` save, at most 1000 ms;
  - clears the timers and the camera rAF;
  - disposes the ELK engine (the worker is terminated, the Blob URL revoked);
  - runs every remover.

## Structure

The six module folders do not import each other (spec/15 §2.5). Types that cross modules live in
`types.ts`. Modules reach each other at run time through `env.actions()`. The root files compose
them:

- `actions.ts` builds the actions of every module once per state, plus the services over link,
  workspace and panels;
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

## Layout engine (elkjs 0.12.0)

- Non-hub flows run ELK in a Blob worker. The worker's text comes from
  `elkjs/lib/elk-worker.min.js`, imported `with { type: "text" }`, so `Bun.build` bundles it into
  the prebuilt tools page. That file ships no declaration, so `layout/elk-worker.d.ts` declares it.
- If the script does not load as text or `new Worker` throws, ELK runs inline on the main thread
  from `elkjs/lib/elk.bundled.js`, with one warning.
- The inline engine needs a DOM. Its embedded fake worker checks `document`, so tests use
  happy-dom.
- Every request takes a sequence number, and a stale result is dropped. Results are cached in an
  LRU of 8.

## Styling

- One sheet per component: `@scope ([data-flow="…"])`, data attributes only, no class selectors,
  no `@layer` wrapper (R7), tokens only.
- Component tokens: `--flow-node-w`, `--flow-row`, `--flow-label-min: 11px` (M14),
  `--flow-strip-h`.
- Stale data areas get `filter: saturate(0.2); opacity: 0.55`, never `backdrop-filter` (M6).
- The note editor is a modal `<dialog>` and the context menu a `popover` (M7, D-14).
