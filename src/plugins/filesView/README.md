# filesView

> Complex plugin (tools core). The Files workspace (design-context §6 A5).

The Files workspace has five parts:

- A 272 px project tree ("Project · 24 files") built from `link.files.list`.
- Open-file tabs with a modified dot.
- A file bar: crumb, Open in editor, Edit here.
- A **Used by** row of flow and node chips.
- The file body: code with line numbers and syntax colour, an in-place editor, and previews for Markdown notes, JSON, images and series `index.json`.

A save with a stale version shows "The file changed on disk · Reload / Overwrite".
A game source saved outside `.moku/` while a game is linked reloads the game frame and restores the state (D-07).
Every indexed file is a palette item (⌘K, group Files).

filesView depends on no view (R4, D-13).
It reaches other views through global events only.

## Configuration

| Field | Default | What |
|---|---|---|
| `maxFiles` | `5000` | Most files the tree walk indexes. The header then reads "Project · 5000+ files". |
| `maxHighlightChars` | `512000` | Files longer than this (characters) show without colour. |
| `reloadExtensions` | `[".ts", ".tsx", ".css", ".json"]` | A save of these, outside `.moku/`, runs the D-07 reload. |
| `revalidateMs` | `2000` | A clean tab is re-read on activation when its last check is older than this. |

```ts
createApp({ pluginConfigs: { filesView: { maxFiles: 10_000 } } });
```

Private constants (`types.ts`): `WALK_CONCURRENCY = 4`, `WALK_MAX_DEPTH = 12`, `INDEX_STALE_MS = 10_000`, `WINDOW_LINES = 2000`, `EDIT_COLOUR_LINES = 5000`.

## API

`app.filesView` is `FilesViewApi`. Each member carries its contract and an example in `types.ts`.

| Member | What |
|---|---|
| `open(path, { line?, edit? })` | Shows Files, opens or activates the tab, reveals it in the tree, loads it. `line` marks that line. |
| `close(path, { discard? })` | Closes a tab. A modified tab without `discard` returns `false` and opens the discard popover. |
| `activate(path)` | Makes a tab active and re-reads it when stale. |
| `tabs()` / `active()` | The tab list and the active path. |
| `edit(on, path?)` | Edit mode on or off. Leaving keeps the buffer. |
| `setBuffer(path, text)` | Replaces the edit buffer. |
| `setMode(path, mode)` | Preview or source, for markdown and series only. |
| `save(path?)` | The save flow. Returns `saved`, `unchanged`, `conflict` or `failed`. Never rejects. |
| `resolveConflict(path, choice)` | `"reload"` drops the buffer. `"overwrite"` writes it over the fresh version. |
| `refresh()` | Rebuilds the index, then Used by and the palette items. |
| `files()` | Indexed file entries in tree order. |
| `fileOf(ref)` / `flowFileOf(flow)` | The protocol node → file rule (R1) against the index. |
| `usedBy(path)` | Flows and nodes whose file is `path`. Empty without a graph. |
| `editorUrl(path, line?)` | The "Open in editor" link from the boot data (D-08). `undefined` without boot data. |
| `subscribe(fn)` | Change listener. Returns an idempotent unsubscribe. |

```ts
await app.filesView.open("nodes/merge.ts", { line: 12 });
app.filesView.usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
```

## Events

filesView declares no events. It uses the global tools-core events of `src/config.ts` (R4).

| Direction | Event | When |
|---|---|---|
| Emits | `workspace:select-node { id }` | A Used-by chip is clicked. A node chip sends `"board/merge"`, a flow chip sends `"<flow>/<start>"`. |
| Emits | `workspace:open-sheet { index }` | "Open contact sheet" on a series `index.json`. |
| Hooks | `link:status` | Builds the index when there is none and no build runs. |
| Hooks | `workspace:changed` | Files shown: rebuilds an index older than 10 s, re-reads the active tab. |
| Hooks | `workspace:open-file { path, line? }` | Opens the file for another view. |

## Lifecycle

- **onInit:** registers the Files panel, binds ⌘S (Files only, while editing) and the `fileEdit` Esc layer. No I/O.
- **onStart:** loads `game.graph` on every manifest, starts the index build without awaiting it, adds the `beforeunload` guard (active only while a tab is modified).
- **onStop:** runs every remover and the palette remover, clears the listeners.

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `files.list/read/write/readBinary`, `read("game.graph")`, `status()`, `onManifest`, `boot()` |
| `workspacePlugin` | `show("files")`, `toast`, `gameFrame().reload`, `palette.add`, `keys.bind`, `keys.escape` |
| `panelsPlugin` | `register(panel)` in onInit |

Shared modules, imported as plain modules (no copy here):

- `registry/protocol` `source-files.ts`: the node → file rule (R1).
- `panels/shared/highlight.ts`: `langOf`, `tokenizeLines`, `renderTokens` (R4).
- `panels/shared/notes.ts`: `parseNote` for note front matter (R4).
- `panels/shared/editor-url.ts`: `editorUrlOf` (R9).

## Read and save errors

| Wire error | Shown |
|---|---|
| `forbidden_path` | "This file is outside the editor's sandbox." |
| -32000 "file too large" | "File too large to open here (over 2 MB) · Open in editor" |
| -32601 `unknown_id` | "The file is gone from disk." with Close tab |
| -32005 `version_conflict` (save) | The conflict bar: Reload / Overwrite |
| any other | The wire message without the `[moku-editor]` prefix (`bareMessage`, R7) |

## Styling

One sheet per component in `view/`, each `@scope ([data-panel="files"] [data-part="<component>"])`.
No sheet wraps itself in `@layer`: the tools page CSS entry imports them into `layer(components)` (R7).
Only data attributes and elements are selected.
Code colours come from the workspace `[data-token]` atoms.

## Notes

- The panel view and `app.filesView` share one state: `createFilesPanel` builds a second api over the same `ctx.state`.
- An unreadable note front matter is shown raw. Only for that display the raw lines are cut at the `---` fences. Parsing stays in the shared `parseNote`.
- A failed read during Reload / Overwrite keeps the tab and its buffer and shows the reason in the status line.
