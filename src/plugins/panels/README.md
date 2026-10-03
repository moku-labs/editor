# panels

> Standard plugin, tools core (`@moku-labs/editor/tools`). The panel host of the tools page. A panel is data; the host owns its subscriptions (design API pick 3A).

View plugins build panels with `definePanel` and register them in their `onInit` (D-04). For
every mounted panel, panels:

- watches each declared source through `link`,
- waits until every source delivered a first value, then renders `view(values, tools)` with Preact,
- marks the data stale on `link:status`,
- re-checks the sources when the manifest changes,
- unwatches everything on unmount and on stop.

Nothing in panels polls. The folder also holds `shared/`, the plain view modules (last section).

## Configuration

`{}`. panels has no options (contracts §5).

## API

`app.panels`, or `ctx.require(panelsPlugin)`. Type `PanelsApi`.

| Member | Signature | What it does |
|---|---|---|
| `register` | `(panel: PanelSpec) => void` | Adds a panel from `definePanel`. Throws `[moku-editor] Panel "<id>" is already registered.` After start, a panel of a mounted workspace mounts at once and gets a palette item. |
| `run` | `(id, input?, origin = "panel") => Promise<RunResult>` | Runs a command outside any render (R9): `link.run`, then the global `workspace:ran` with the origin (`panel`, `key` or `palette`). Resolves or rejects like `link.run`. |
| `list` | `() => readonly PanelSpec[]` | Every registered panel, in registration order (a copy). |
| `mountInto` | `(ws, element) => () => void` | Mounts every panel of a workspace, one `<section data-panel>` each, in registration order. The same element is a no-op. Another element moves the mount. Returns the unmount function. |

```ts
panels.register(flowPanel);
await panels.run("game.step", { frames: 1 });
app.panels.list().length; // 13
const unmount = panels.mountInto("flow", workspace.host("flow"));
```

### definePanel

`definePanel(input)` is runtime-free and exported from `"."`. It returns a frozen, closure-erased
`PanelSpec`.

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | `/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/`, e.g. `"flow.inspector"`. |
| `title` | `string` | Section title and palette label. |
| `workspace` | `WorkspaceId` | Where the panel mounts. |
| `sources` | `Record<string, SourceRef>` | Name → `"id"` or `["id", input]`. `{}` renders at once. |
| `commands` | `Record<string, string>`, optional | Name → dotted command id. |
| `view` | `(values, tools) => PanelElement` | Any Preact element. JSX and `h(Component, props)` both fit. |
| `compact` | optional | Reserved for the in-game overlay host. No editor panel uses it. |

It throws `[moku-editor] <what> is invalid.\n  <fix>.` for a bad id, workspace, source ref,
command id, `view` or `compact`.

```ts
import { definePanel } from "@moku-labs/editor";

export const statePanel = definePanel({
  id: "state", title: "State", workspace: "state",
  sources: { model: "game.model", position: "game.position", history: ["game.history", { last: 1 }] },
  view: (values, tools) => h(StateView, { values, tools })
});
```

`tools` (`PanelTools`) holds:

| Member | What |
|---|---|
| `run` | One function per command name. Each call emits `workspace:ran` with origin `panel`. |
| `status` | The link status at this render. |
| `channel` | link's `read` and `watch`. Its `run` goes through the same report as `tools.run`. |
| `files` | `link.files`. |
| `workspace` | The workspace api. |

A view never emits `workspace:ran` itself.

### Typed values (`catalogue.ts`)

`catalogue.ts` maps the engine's doors to types, with type imports only.

- Each `game.<key>` source gives `Wire<ReturnType<read>>` (`SourceValue<Id>`).
- Each `game.<key>` command gives its input type (`CommandArgs<Id>`).
- `.dev` ids and unknown ids stay `Json`.

If an engine change breaks the map, only `catalogue.ts` changes: `GameSourceValues` and
`GameCommandInputs` become `Record<never, never>` and every value falls back to `Json`.

## Mount behaviour

| `data-panel-state` | When | Line (`role="status"`) |
|---|---|---|
| `missing` | The manifest lacks a declared source. It is not watched. | "This game does not provide `<ids>`." |
| `no-game` | Not every value yet; link `empty`, `connecting` or `lost`. | "No game connected · this panel fills in when a game connects." |
| `waiting` | Not every value yet, otherwise. | Empty; after 400 ms "Waiting for `<ids>`…" with `[data-spinner]`; after 5 s "No value from `<ids>` yet. Check the source input." |
| `ready` | Every value received. | The view, inside `PanelBoundary`. |
| `error` | The view threw. | "This panel failed · `<message>`", logged as `panels:view-failed`. Other panels keep running. |

Renders are coalesced to one per animation frame.

| Link status | `data-stale` on the section |
|---|---|
| `silent` | `silent` |
| `lost`, `empty` | `lost` |
| `connecting` | clears `fresh`, then `resync` while a received value is not fresh again |
| `live`, `paused` | `resync` while a received value is not fresh again |

Otherwise the attribute is absent. The fade is the workspace `[data-stale]` atom. `panels.css`
holds the section and placeholder layout in one `@scope ([data-panel])`, with no `@layer` wrapper
(R7).

## Events

panels declares no plugin events. It uses global tools events from `src/config.ts`.

| Direction | Event | Payload | When |
|---|---|---|---|
| emits | `workspace:ran` | `RanEvent` | Once per `tools.run` or `channel.run` call (origin `panel`), and once per api `run` call (its origin). `ok: false` carries the `WireError`; the promise still rejects. |
| hooks | `link:status` | `{ status, session? }` | Stores the status and calls `setStatus` on every mounted panel. |
| hooks | `workspace:changed` | `{ ws }` | After start, mounts a workspace not mounted yet into `workspace.host(ws)`. |

## Dependencies

| Kind | What |
|---|---|
| `depends` | `linkPlugin` (`watch`, `read`, `run`, `status`, `manifest`, `onManifest`, `files`), `workspacePlugin` (`active`, `host`, `palette.add`, `show`). |
| Global events | emits `workspace:ran`; hooks `link:status`, `workspace:changed`. |
| Packages | `preact`. |

## Usage

A view plugin registers its panels in `onInit`:

```ts
import { definePanel } from "@moku-labs/editor";

export const flowPanel = definePanel({
  id: "flow",
  title: "Flow",
  workspace: "flow",
  sources: { graph: "game.graph", position: "game.position", history: ["game.history", { last: 20 }] },
  commands: { step: "game.step" },
  view: ({ graph, position, history }, { run, status }) => h(FlowCanvas, { graph, position, history, run, status })
});

// in the view plugin's onInit
ctx.require(panelsPlugin).register(flowPanel);
```

## Lifecycle

| Phase | Does |
|---|---|
| `onStart` | Takes the link status, mounts the active workspace, adds one palette item per panel (group Panels, id `panel:<id>`), subscribes `link.onManifest` → `recheck` on every panel. |
| `onStop` | Unmounts every panel (every unwatch runs) and runs the removers. |

## Integration notes

- Hosts exist before `workspace.mount`, so panels renders in `onStart` into hosts the shell attaches a moment later. Views measure layout in effects and `ResizeObserver` callbacks.
- Mounted workspaces stay mounted while hidden, so camera, selection and scroll survive a switch.
- A panel's palette item shows its workspace, then focuses its section.
- consoleView and stateView see every panel run through `workspace:ran`.

## Limits

- `EditorChannel.watch` has no error path. A failed watch shows as `waiting`, then the 5 s text; link logs `link:watch-failed`.
- `compact` is reserved for game panels in the in-game overlay (manifest field `panels`). No host renders it yet.

## Shared view modules (`shared/`)

Plain modules for the views. They exist so flowView, gameView and filesView share one
implementation without importing each other (D-16).

Rules for all six:

- No plugin, no `ctx`, no state, no timers, no logging.
- Bad input never throws. Functions return a typed error value; the view writes its own text.
- Only `loadStyleFile` and `writeNumber` are async. They do I/O through the files client they get.
- Not exported from `"."` and not a plugin api. Views import them by relative path, e.g. `../panels/shared/style-edit`.
- Imports: the protocol by relative path; `preact` in `highlight.ts` only.

| Module | Imported by | Holds |
|---|---|---|
| `style-edit.ts` | flowView, gameView | Style blocks of a TS source file, the one safe numeric-literal edit, the version-checked write. |
| `notes.ts` | flowView, gameView, filesView | The codec of `.moku/notes/<date>-<slug>.md` front matter. |
| `highlight.ts` | flowView, filesView | The one syntax highlighter (TS/TSX, CSS, JSON, Markdown). |
| `tokens.ts` | renderView | CSS custom property names of the workspace tokens. |
| `scene/` | gameView, renderView | The scene mapping from `game.ui`, `game.entities`, `game.projections`. |
| `editor-url.ts` | flowView, filesView | The "Open in editor" link. |

### `style-edit.ts`

| Export | Signature | What |
|---|---|---|
| `parseStyleFile` | `(text) => StyleFile \| StyleEditError` | Blocks, fields with exact columns, colour identifiers. |
| `findBlock` | `(file, ref) => StyleBlock \| StyleEditError` | One block by `{ kind: "text", key }` or `{ kind: "const", name }`. |
| `fieldRule` | `(ref, path) => FieldRule \| undefined` | Stepper bounds. Views keep no bounds of their own. |
| `stepValue` | `(rule, value, direction, big) => number` | One step, clamped, rounded. |
| `formatNumber` | `(value) => string` | Up to 2 decimals. |
| `editNumber` | `(text, target, next) => EditDone \| StyleEditError` | Rewrites one literal's columns and re-parses to check. |
| `loadStyleFile` | `(files, path) => Promise<LoadedStyleFile \| StyleEditError>` | Reads and parses. |
| `writeNumber` | `(files, path, current, target, next) => Promise<WriteDone \| StyleEditError>` | Version-checked write with one retry. |
| `isStyleEditError` | `(value) => value is StyleEditError` | Guard. |

Error codes (`StyleEditCode`): `no-file`, `parse`, `no-key`, `ambiguous`, `not-literal`,
`read-only`, `changed-on-disk`, `out-of-range`.

```ts
const loaded = await loadStyleFile(tools.files, "features/ui/styles.ts");
if (isStyleEditError(loaded)) return showReason(loaded);
await writeNumber(tools.files, "features/ui/styles.ts", loaded, target, 64);
// { ok: true, line: 74, version: "9c1e…", … }
```

Limit: the scanner does not recognise regex literals. Style files have none.

### `notes.ts`

| Export | Signature | What |
|---|---|---|
| `NOTE_STATUSES` | `["idea", "todo", "done"]` | Known statuses. Unknown ones are kept. |
| `parseNote` | `(text) => Note \| NoteParseError` | Lenient parse. Unknown keys stay in `extra`. |
| `formatNote` | `(note) => string` | Writes the note back, keeping its line ending. |
| `newNote` | `(input: NewNote) => Note` | A new note; status `idea` by default. |
| `addCaptures` | `(note, paths) => Note` | Adds capture paths. |
| `isNoteParseError` | `(value) => value is NoteParseError` | Guard. An unreadable file is never rewritten. |

```ts
const note = newNote({ title: "First wood 4", from: { node: "board/merge", outcome: "done" } });
await files.write(path, formatNote(addCaptures(note, [".moku/captures/2026-09-24-1012-board.png"])));
```

File naming stays in flowView.

### `highlight.ts`

| Export | Signature | What |
|---|---|---|
| `Lang` | type | `"script" \| "css" \| "json" \| "markdown" \| "plain"`. |
| `TokenKind`, `Token` | types | `{ text, kind }`; 15 kinds from `plain` to `heading`. |
| `langOf` | `(path) => Lang` | By extension. |
| `tokenizeLines` | `(text, lang) => Token[][]` | One token list per line. |
| `renderTokens` | `(line) => ComponentChildren` | `<span data-token="<kind>">` VNodes. No innerHTML, no class. |

```ts
const lines = tokenizeLines(text, langOf("nodes/merge.ts"));
lines.map((line, index) => h("div", { "data-line": index + 1 }, renderTokens(line)));
```

Colours come from the workspace `[data-token]` atoms and the `--code-*` tokens.

### `tokens.ts`

Names only. Values live in `workspace/styles/tokens.css`. A panels test checks that every name
here is declared there.

| Export | What |
|---|---|
| `token` | Semantic and layout names, e.g. `accent: "--accent"`, `topbarH: "--topbar-h"`. |
| `TokenName` | `keyof typeof token`. |
| `codeToken` | `--code-<kind>` for every highlight `TokenKind`. |
| `duration` | `camera`, `zoom`, `follow`, `strip`, `walk`, `resize`, `toast` → `--duration-*`. |
| `cssVar(name)` | `"var(--accent)"`. |
| `readToken(element, name)` | Computed value, `""` when unset. |
| `readDuration(element, name)` | `"420ms"` → 420, `"0.2s"` → 200, unset or invalid → 0. |

```ts
h("polyline", { stroke: cssVar("accent"), "stroke-width": 1.5, points });
readDuration(canvasElement, "camera"); // 420
```

The reduced-motion check stays in the views.

### `scene/`

The barrel `scene/index.ts` exports:

| Export | Signature | What |
|---|---|---|
| `buildScene` | `(input: SceneInput) => SceneSnapshot \| SceneError` | Element tree with stable refs, roots, paint order, referenced textures. |
| `refId` | `(ref: ElementRef) => string` | `"ui:<path>"` or `"entity:<id>"`. |
| `calibrationTarget` | `(ui: Json) => { key, drawn } \| undefined` | The first keyed ui element and its drawn rect, to calibrate from. |
| `calibrationFrom` | `(page, drawn) => Calibration` | Reference units → page px. |
| `toPage` | `(rect, calibration) => PageRect` | Applies a calibration. |
| `drawnRect` | `(natural, fits) => PageRect` | The drawn rect through the fit chain. |
| `elementAt` | `(scene, point) => SceneNode \| undefined` | Topmost node at a point. |
| `pageFromClient` / `clientFromPage` | `(point, box: FrameBoxLike) => point` | Tools page ↔ game page. |
| `ancestorsOf` | `(scene, id) => readonly string[]` | Root first. |
| `parseTextureManifest` | `(text, path) => TextureCatalogue \| undefined` | Texture catalogue with GPU MB. |

Types: `PageRect`, `ElementRef`, `SceneNode`, `SceneSnapshot`, `Calibration`, `SceneInput`,
`SceneError`, `TextureInfo`, `TextureCatalogue`, `FrameBoxLike`. `ElementRef` is the payload of the
global `workspace:reveal` and `workspace:inspect`; `src/config.ts` imports it from here.

```ts
const scene = buildScene({ ui, entities, projections, frame: 1841, calibration });
if ("error" in scene) ctx.log.warn("gameView: scene shape", scene);
elementAt(scene, { x: 540, y: 990 })?.ref; // { kind: "entity", id: 1048628 }
```

The module does no I/O. Views read or watch the sources and pass the values in.

Findings of the scene spike on merge-game (fixtures `__tests__/fixtures/scene-board.txt` and
`scene-settings.txt`, checked by `shared-scene.test.ts`):

| Finding | What `scene/` does |
|---|---|
| Several roots come under a synthetic `screen` root (no key, rect 0,0,0,0, popups first). | The synthetic root is no node. Its children are the roots. Paint order reverses them. |
| Two hosts share one rect, so one `Box` matches two. | The parent ui key from `game.projections` picks the host. A tie without a key leaves the entity unplaced. |
| Projection roots have no `Transform` and no `Parent`. | Roots with `rect: undefined`. |
| Text-only views have no size component. | Listed under their host with `rect: undefined`. |
| On the inert renderer `game.rect` is the natural rect. | Calibration is identity. |
| A ui image keeps its texture on its entity's `Sprite`. | `texture` stays `style.nineSlice`. `referencedTextures` has the key. |

Follow-up F-G1: `scene/` exists until the game ships a display-tree source.

### `editor-url.ts`

`editorUrlOf(template, root, path, line?) => string | undefined`. Pure. `{path}` is the encoded
`root/path`, `{line}` defaults to 1. `undefined` when `template` or `root` is empty. The server
never spawns a process.

```ts
editorUrlOf("vscode://file/{path}:{line}", "/Users/alex/game", "nodes/merge.ts", 12);
// "vscode://file/Users/alex/game/nodes/merge.ts:12"
```
