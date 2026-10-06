# filesView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Files workspace: project tree, tabs, viewer, editor and previews.

The Files workspace has five parts:

- A project tree ("Project · 24 files") built from `link.files.list`, in the SidePanel `files.tree`.
- Open-file tabs with a modified dot.
- A file bar: crumb, Open in editor, Edit here.
- A **Used by** row from the project index: flow and node chips of what the file defines, and a "Used in" row of the files that use it.
- The file body: code with line numbers and syntax colour, an in-place editor, and previews for Markdown, JSON, images and series `index.json` (`.moku/captures/<yyyy-mm-dd>/series-*/index.json`, and the older flat `.moku/captures/series-*/index.json`).

A save with a stale version shows "The file changed on disk · Reload / Overwrite".
A game source saved outside `.moku/` while a game is linked reloads the game frame and restores the state (D-07).
Every indexed file is a palette item (⌘K, group Files).
Where code lives comes only from the project index (`link.project()`, `link.files.find`). There is no naming rule and no `.moku/editor/files.json`.

### The tree panel

The tree docks to the start edge in `SidePanel id="files.tree"` (panels/shared/side-panel, D-29): 272 px by default, resizable from 200 to 480 px.

- `\` (Files only, not in inputs) collapses or expands it.
- Its × closes it. A reopen button `data-action="reopen-files.tree"` then shows at the start edge. The palette item "Show Files tree" (Commands) shows Files and the tree.
- Below a 600 px Files container (the Claude pane at 1/3) it floats over the editor as a drawer and starts collapsed. Picking a file shuts the drawer.
- A folder in the file bar's crumb shows the tree (reopened, expanded, or its drawer opened), reveals the folder and focuses its row.
- Width, collapsed and closed persist in localStorage `moku-editor:panel:files.tree`.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxFiles` | `number` | `5000` | Most files the tree walk indexes. The header then reads "Project · 5000+ files". |
| `maxHighlightChars` | `number` | `512_000` | Files longer than this (characters) show without colour. |
| `reloadExtensions` | `readonly string[]` | `[".ts", ".tsx", ".css", ".json"]` | A save of these, outside `.moku/`, runs the D-07 reload. |
| `revalidateMs` | `number` | `2000` | A clean tab is re-read on activation when its last check is older than this, in ms. |

Constants in `types.ts`, not config:

| Constant | Value | Meaning |
|---|---|---|
| `WALK_CONCURRENCY` | `4` | Parallel `files.list` calls of the walk. |
| `WALK_MAX_DEPTH` | `12` | Deepest folder level the walk enters. |
| `INDEX_STALE_MS` | `10_000` | Showing Files rebuilds an index older than this. |
| `WINDOW_LINES` | `2000` | The viewer windows files longer than this. |
| `EDIT_COLOUR_LINES` | `5000` | The editor drops colour above this. |
| `SERVER_READ_LIMIT_BYTES` | `2 * 1024 * 1024` | The server's read limit. |

## API

`app.filesView` is `FilesViewApi` (`types.ts`). Every path is relative to the project root.
The panel view and `app.filesView` share one state: `createFilesPanel` builds a second api over the same `ctx.state`.

| Member | Signature | What |
|---|---|---|
| `open` | `(path, options?: { line?: number; edit?: boolean }) => Promise<void>` | Shows Files, opens or activates the tab, reveals it in the tree, loads it. Images go through `readBinary`. `line` marks that line. `edit` opens in edit mode (not for images). |
| `close` | `(path, options?: { discard?: boolean }) => boolean` | Closes a tab. A modified tab without `discard` returns `false` and opens the discard popover. |
| `activate` | `(path) => void` | Makes a tab active. Re-reads it when its last check is older than `revalidateMs`. |
| `tabs` | `() => readonly TabInfo[]` | Open tabs in tab order: `{ path, kind, modified, editing, status }`. |
| `active` | `() => string \| undefined` | The active tab's path. |
| `edit` | `(on: boolean, path?) => void` | Edit mode on or off. Leaving keeps the buffer. Markdown and series switch to source first. Images: no-op. |
| `setBuffer` | `(path, text) => void` | Replaces the edit buffer. Notifies. |
| `setMode` | `(path, mode: "preview" \| "source") => void` | For markdown and series tabs only. |
| `save` | `(path?) => Promise<SaveResult>` | The save flow. `saved`, `unchanged`, `conflict` or `failed`. Never rejects. |
| `resolveConflict` | `(path, choice: "reload" \| "overwrite") => Promise<SaveResult>` | `reload` drops the buffer and returns `unchanged`. `overwrite` writes the buffer over the fresh version. |
| `refresh` | `() => Promise<void>` | Rebuilds the index (single flight: a call during a walk walks once more after it, `indexDirty`), then Used by and the palette items. |
| `files` | `() => readonly FileEntry[]` | Indexed entries in tree order. Empty before the first index. |
| `fileOf` | `(ref: NodeRef) => string \| undefined` | The file that defines a graph node: the first def of `node:<flow>/<node>` in the project index. `undefined` while the index is off or does not know the node. |
| `flowFileOf` | `(flow: string) => string \| undefined` | The file that defines a flow: the first def of `flow:<name>`. |
| `usedBy` | `(path) => UsedBy` | `{ flows, nodes, usedIn }`: the flows and nodes defined in `path`, and the files that use them (`usedIn` of `panels/shared/project`). No game needed. Empty while the index is off. |
| `editorUrl` | `(path, line?) => string \| undefined` | The "Open in editor" link from the boot data (D-08). `undefined` without boot data. |
| `subscribe` | `(fn: () => void) => () => void` | Change listener. Returns an idempotent unsubscribe. |

```ts
await app.filesView.open("nodes/merge.ts", { line: 12 });
app.filesView.active(); // "nodes/merge.ts"
app.filesView.usedBy("nodes/merge.ts");
// { flows: [], nodes: [{ flow: "board", node: "merge" }], usedIn: ["flows/board.ts"] }
app.filesView.fileOf({ flow: "settingsPopup", node: "open" }); // "features/settings/nodes.ts"
app.filesView.flowFileOf("board"); // "flows/board.ts"

app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
(await app.filesView.save()).kind; // "saved"
(await app.filesView.save()).kind; // "unchanged"

app.filesView.close("nodes/merge.ts"); // false when modified: the popover opens
app.filesView.close("nodes/merge.ts", { discard: true }); // true
```

### Used by

| Index | Shown |
|---|---|
| on, the file defines flows or nodes | "Used by" with `flow <name>` and `<flow>/<node>` chips. A chip emits `workspace:select-node`. |
| on, other files use what it defines | "Used in" with a chip per file. A chip opens the file. |
| on, neither | "Used by · no node, flow or file" |
| off, or no state yet | "Used by · Project index is off: <reason>" (`projectOffText`) |

### Tabs follow the project index

Each `link:project` delta is applied after the one before it (`state.following`).

- **Moved file.** A text tab at `moved[].from` whose file is gone is replaced at the same place by a tab at the first `to`. Buffer, edit mode, mode and saved text stay. The active tab and the discard popover follow. The line comes from the answer of `files.find(key)` at the new path; without one the tab keeps its line. The status line reads "Moved from <from>". The same bytes keep the tab as it was; other bytes replace a clean tab and put a modified one in conflict. A tab that loads or saves, a file still on disk, and a path that already has a tab are left alone.
- **Changed file.** Tabs of `delta.files` are re-read at once, without waiting `revalidateMs`. All tabs after a revision gap (`delta.all`). A gone file shows missing; a missing tab whose file is back is ready again.
- **Tree.** A move, a gone key, a path the tree does not have, or a gone file still in the tree rebuilds the tree. A rebuild asked while a walk runs walks once more after it, since that walk may have listed the folder before the change.

### Read and save errors

| Wire error | Shown |
|---|---|
| `forbidden_path` | "This file is outside the editor's sandbox." |
| -32000 "file too large" | "File too large to open here (over 2 MB)" with Open in editor |
| -32601 `unknown_id` | "The file is gone from disk." with Close tab |
| -32005 `version_conflict` (save) | The conflict bar: Reload / Overwrite |
| any other | The wire message without the `[moku-editor]` prefix (`bareMessage`, R7) |

## Events

filesView declares no events. It uses the global tools events of `src/config.ts` (R4).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:select-node` | `{ id }` | A Used-by chip is clicked. A node chip sends `"board/merge"`. A flow chip sends `"<flow>/<start>"`, or the flow name when it has no start. |
| Emits | `workspace:open-sheet` | `{ index }` | "Open contact sheet" on a series `index.json`. |
| Hooks | `link:status` | `{ status, session? }` | Builds the index when there is none, no build runs and the socket is open (not `connecting`, not `lost`). Notifies. |
| Hooks | `link:project` | `{ state, delta }` | Notifies (Used by reads the new state). The open tabs follow the delta (see above). |
| Hooks | `workspace:changed` | `{ ws }` | `ws === "files"`: rebuilds an index older than `INDEX_STALE_MS`, re-reads the active tab. |
| Hooks | `workspace:open-file` | `{ path, line? }` | Opens the file for another view. A failure logs `filesView:open-failed`. |

Log events: `filesView:read-failed`, `filesView:revalidate-failed`, `filesView:open-failed`, `filesView:list-failed`, `filesView:index-failed`, `filesView:reload-failed`, `filesView:follow-failed`, `filesView:graph-failed` (warn; debug when the read was lost to a reload, and the next manifest reads it again); `filesView:save-failed` (error).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `project()`, `files.find`, `files.list`, `files.read`, `files.write`, `files.readBinary`, `read("game.graph")` (the start node of a flow chip), `status()`, `onManifest`, `boot()` |
| `workspacePlugin` | `show("files")`, `active()`, `toast`, `gameFrame().reload`, `palette.add` (files, "Show Files tree"), `keys.bind` (⌘S, `\`), `keys.escape` |
| `panelsPlugin` | `register` the `files` panel |

Shared modules, imported as plain modules:

| Module | Used for |
|---|---|
| `registry/protocol` (`project.ts`) | `firstDefinition` for `fileOf` and `flowFileOf`. |
| `panels/shared/project.ts` | `usedIn`, `projectOffText`. |
| `panels/shared/highlight.ts` | `langOf`, `tokenizeLines`, `renderTokens`. |
| `panels/shared/side-panel/` | `SidePanel`, `useSidePanel`, `showSidePanel`, `toggleSidePanel`, `sidePanelState` for the tree panel. |
| `panels/shared/editor-url.ts` | `editorUrlOf` (R9). |

filesView depends on no view (R4, D-13).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Files panel. Binds ⌘S (`mod+s`, Files only, while editing), `\` (the tree panel, Files only) and the `fileEdit` Esc layer. Adds the "Show Files tree" palette item. No I/O. |
| `onStart` | Loads `game.graph` on every manifest. Starts the index build without awaiting it when the socket is open; otherwise the first `link:status` with an open socket starts it. Adds the `beforeunload` guard, active only while a tab is modified. |
| `onStop` | Runs every remover and the palette remover. Clears the listeners. |

## Usage

```ts
const app = createApp({ pluginConfigs: { filesView: { maxFiles: 10_000 } } });
await app.start();
await app.filesView.refresh();
app.filesView.files().length; // 24
```

Another view opens a file without depending on filesView:

```ts
ctx.emit("workspace:open-file", { path: "nodes/merge.ts", line: 12 });
```

## Integration

- **flowView** hooks `workspace:select-node` from the Used-by chips. It emits `workspace:open-file` from the Inspector. Both views ask the project index.
- **gameView** hooks `workspace:open-sheet` and opens the contact sheet of a series. gameView writes the series `index.json` that filesView previews.
- **workspace** serialises the D-07 reload (`gameFrame().reload({ restore: true, afterSave: true, since })`, `since` taken before the write). It runs only for `reloadExtensions` outside `.moku/` while the link is live or paused.
- A Markdown front matter shows as one plain block (`<pre data-front-matter>`) of its raw lines, cut at the `---` fences. filesView parses no front matter.
- A failed read during Reload / Overwrite keeps the tab and its buffer and shows the reason in the status line.

## Styling

One sheet per component in `view/`, each `@scope ([data-panel="files"] [data-part="<component>"])`.
`FilesView.css` makes the view `position: relative`: it is the containing block of the tree drawer. The tree's edge line and width come from the SidePanel sheet.
No sheet wraps itself in `@layer`: the tools page CSS entry imports them into `layer(components)` (R7).
Only data attributes and elements are selected. Code colours come from the workspace `[data-token]` atoms.
Markdown renders as VNodes, never `innerHTML`. Links only for http(s) and relative paths.

## Limits and game follow-ups

| Limit | Follow-up |
|---|---|
| Without the project index (game < 0.7.0, no `typescript`, open failed) there is no Used by and no node file. Nothing is guessed. | None. Install the requirements. |
| Files over 2 MB do not open here. | None. Open in editor. |
| The walk stops at `maxFiles` and `WALK_MAX_DEPTH`. | None. |
