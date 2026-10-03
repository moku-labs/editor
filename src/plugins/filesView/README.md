# filesView

> Complex plugin of the **tools** core (`createToolsPlugin`). The Files workspace: project tree, tabs, viewer, editor and previews.

The Files workspace has five parts:

- A 272 px project tree ("Project · 24 files") built from `link.files.list`.
- Open-file tabs with a modified dot.
- A file bar: crumb, Open in editor, Edit here.
- A **Used by** row of flow and node chips.
- The file body: code with line numbers and syntax colour, an in-place editor, and previews for Markdown notes, JSON, images and series `index.json`.

A save with a stale version shows "The file changed on disk · Reload / Overwrite".
A game source saved outside `.moku/` while a game is linked reloads the game frame and restores the state (D-07).
Every indexed file is a palette item (⌘K, group Files).

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
| `refresh` | `() => Promise<void>` | Rebuilds the index (single flight), then Used by and the palette items. |
| `files` | `() => readonly FileEntry[]` | Indexed entries in tree order. Empty before the first index. |
| `fileOf` | `(ref: NodeRef) => string \| undefined` | The source file of a graph node: its own graph `file` (F-H2) first, else the protocol rule (R1) against the index. Same rule as flowView. |
| `flowFileOf` | `(flow: string) => string \| undefined` | The source file of a flow by the same rule. |
| `usedBy` | `(path) => UsedBy` | `{ flows, nodes }` whose file is `path`. Empty without a graph. |
| `editorUrl` | `(path, line?) => string \| undefined` | The "Open in editor" link from the boot data (D-08). `undefined` without boot data. |
| `subscribe` | `(fn: () => void) => () => void` | Change listener. Returns an idempotent unsubscribe. |

```ts
await app.filesView.open("nodes/merge.ts", { line: 12 });
app.filesView.active(); // "nodes/merge.ts"
app.filesView.usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
app.filesView.fileOf({ flow: "board", node: "awaitIntent" }); // "nodes/await-intent.ts"
app.filesView.flowFileOf("board"); // "flows/board.ts"

app.filesView.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
(await app.filesView.save()).kind; // "saved"
(await app.filesView.save()).kind; // "unchanged"

app.filesView.close("nodes/merge.ts"); // false when modified: the popover opens
app.filesView.close("nodes/merge.ts", { discard: true }); // true
```

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
| Hooks | `link:status` | `{ status, session? }` | Builds the index when there is none and no build runs. Notifies. |
| Hooks | `workspace:changed` | `{ ws }` | `ws === "files"`: rebuilds an index older than `INDEX_STALE_MS`, re-reads the active tab. |
| Hooks | `workspace:open-file` | `{ path, line? }` | Opens the file for another view. A failure logs `filesView:open-failed`. |

Log events: `filesView:graph-failed`, `filesView:read-failed`, `filesView:revalidate-failed`, `filesView:open-failed`, `filesView:list-failed`, `filesView:index-failed`, `filesView:reload-failed`, `filesView:overrides-invalid` (warn); `filesView:save-failed` (error); `filesView:overrides-missing` (debug).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `files.list`, `files.read`, `files.write`, `files.readBinary`, `read("game.graph")`, `status()`, `onManifest`, `boot()` |
| `workspacePlugin` | `show("files")`, `active()`, `toast`, `gameFrame().reload`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register` the `files` panel |

Shared modules, imported as plain modules:

| Module | Used for |
|---|---|
| `registry/protocol` (`source-files.ts`) | The node → file rule (R1): `nodeFile`, `flowFile`, overrides of `.moku/editor/files.json`. |
| `panels/shared/highlight.ts` | `langOf`, `tokenizeLines`, `renderTokens`. |
| `panels/shared/notes.ts` | `parseNote` for note front matter. |
| `panels/shared/editor-url.ts` | `editorUrlOf` (R9). |

filesView depends on no view (R4, D-13).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Files panel. Binds ⌘S (`mod+s`, Files only, while editing) and the `fileEdit` Esc layer. No I/O. |
| `onStart` | Loads `game.graph` on every manifest. Starts the index build without awaiting it. Adds the `beforeunload` guard, active only while a tab is modified. |
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

- **flowView** hooks `workspace:select-node` from the Used-by chips. It emits `workspace:open-file` from the Inspector. Both views use the same node → file rule.
- **gameView** hooks `workspace:open-sheet` and opens the contact sheet of a series. gameView writes the series `index.json` that filesView previews.
- **workspace** serialises the D-07 reload (`gameFrame().reload({ restore: true })`). It runs only for `reloadExtensions` outside `.moku/` while the link is live or paused.
- An unreadable note front matter is shown raw, cut at the `---` fences. Parsing stays in the shared `parseNote`.
- A failed read during Reload / Overwrite keeps the tab and its buffer and shows the reason in the status line.

## Styling

One sheet per component in `view/`, each `@scope ([data-panel="files"] [data-part="<component>"])`.
No sheet wraps itself in `@layer`: the tools page CSS entry imports them into `layer(components)` (R7).
Only data attributes and elements are selected. Code colours come from the workspace `[data-token]` atoms.
Markdown renders as VNodes, never `innerHTML`. Links only for http(s) and relative paths.

## Limits and game follow-ups

| Limit | Follow-up |
|---|---|
| Most graph nodes carry no file. A node `file` wins when the game sends it; else the file comes from the naming rule and `.moku/editor/files.json` overrides. flowView's Inspector uses the same order. | F-H2: a dev-only `file` on graph nodes. |
| Files over 2 MB do not open here. | None. Open in editor. |
| The walk stops at `maxFiles` and `WALK_MAX_DEPTH`. | None. |
