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
app.panels.list().length; // 6: one panel per workspace
const unmount = panels.mountInto("flow", workspace.host("flow"));
```

### definePanel

`definePanel(input)` is runtime-free and exported from `"."`. It lives in `shared/define.ts`; the
views import it from `../panels/shared/define`. It returns a frozen, closure-erased `PanelSpec`.

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
| `lost` with `reloading: true` (`isReloading`, an expected reload, U9) | absent: the section keeps its last values until the new session's arrive |
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

Plain modules for the views and the workspace shell. They exist so the views share one
implementation without importing each other or workspace internals (D-16).

Rules for all of them:

- No plugin, no `ctx`, no timers, no logging.
- No state, except `side-panel/`: it keeps the state of each side panel (D-29), in memory and in localStorage.
- Bad input never throws. Functions return a typed error value; the view writes its own text. The
  one exception is `definePanel`: a malformed panel throws at startup.
- Only `loadStyleFile`, `writeNumber`, `findFresh` and `findAllFresh` are async. They do I/O through the files client they get.
- Not exported from `"."` and not a plugin api, except `definePanel`. Views and workspace import them by relative path, e.g. `../panels/shared/style-edit`.
- Imports: the protocol by relative path; `preact` in `highlight.ts`, `icons.tsx` and `side-panel/` only; `define.ts` imports only `workspaces.ts` at runtime; `workspaces.ts` takes the `WorkspaceId` type from workspace.

| Module | Imported by | Holds |
|---|---|---|
| `project.ts` | flowView, gameView, filesView, renderView | What the views ask the project index: `findFresh`, `findAllFresh`, `textStylesFile`, `usedIn`, `manifestOf` and the shared texts. |
| `style-edit.ts` | flowView, gameView | Style blocks of a TS source file, the one safe numeric-literal edit, the version-checked write, the broken guard. |
| `highlight.ts` | flowView, filesView | The one syntax highlighter (TS/TSX, CSS, JSON, Markdown). |
| `tokens.ts` | renderView | CSS custom property names of the workspace tokens. |
| `scene/` | gameView, renderView | The scene mapping from `game.ui`, `game.entities`, `game.projections`. |
| `editor-url.ts` | flowView, filesView | The "Open in editor" link. |
| `side-panel/` | flowView, gameView, filesView | The one SidePanel of every view's side panel: resize, collapse, close and reopen, overlay. |
| `icons.tsx` | workspace, flowView | `Icon` and `IconName`: the 16 px stroke icons of the shell and the views, `aria-hidden`. |
| `define.ts` | the six views, `"."` | `definePanel`: validates and freezes a panel. |
| `workspaces.ts` | workspace, panels | `WORKSPACE_IDS` in rail order (Game first) and `WORKSPACE_LABELS`. |
| `editable.ts` | workspace, gameView | `isEditableTarget`: whether a target types text (input, textarea, select, contenteditable). |

### `style-edit.ts`

| Export | Signature | What |
|---|---|---|
| `parseStyleFile` | `(text) => StyleFile \| StyleEditError` | Blocks, fields with exact columns, colour identifiers, and `calls`: every `defineStyle({` no const binds, with its line, column and fields. |
| `findBlock` | `(file, ref) => StyleBlock \| StyleEditError` | One block by `{ kind: "text", key }` or `{ kind: "const", name }`, or the call of a style function by `{ kind: "call", name, line, column }` (G2): the first call on `line` at or after `column`, under the asked ref. |
| `fieldRule` | `(ref, path) => FieldRule \| undefined` | Stepper bounds. Views keep no bounds of their own. |
| `stepValue` | `(rule, value, direction, big) => number` | One step, clamped, rounded. |
| `formatNumber` | `(value) => string` | Up to 2 decimals. |
| `editNumber` | `(text, target, next) => EditDone \| StyleEditError` | Rewrites one literal's columns and re-parses to check. |
| `loadStyleFile` | `(files, path) => Promise<LoadedStyleFile \| StyleEditError>` | Reads and parses. |
| `writeNumber` | `(files, path, current, target, next) => Promise<WriteDone \| StyleEditError>` | Version-checked write with one retry. With `files.find`, the index is asked before each write (D-44). |
| `STYLE_BROKEN_TEXT` | `string` | "The file does not parse now · fix it, then edit". |
| `isStyleEditError` | `(value) => value is StyleEditError` | Guard. |

Error codes (`StyleEditCode`): `broken`, `no-file`, `parse`, `no-key`, `ambiguous`, `not-literal`,
`read-only`, `changed-on-disk`, `out-of-range`.

Broken guard (D-44). `StyleFiles` has an optional `find`. `writeNumber` and its one retry call
`find(anchorKey(ref, path))` first. An answer on `path` with `broken: true` means the index
answered from the last good parse: the file does not parse now. The write is refused as
`{ error: "broken", path }` and nothing is written. A rejected `find` does not refuse the write.

```ts
const loaded = await loadStyleFile(tools.files, "features/ui/styles.ts");
if (isStyleEditError(loaded)) return showReason(loaded);
await writeNumber(tools.files, "features/ui/styles.ts", loaded, target, 64);
// { ok: true, line: 74, version: "9c1e…", … }
```

Styles built in a function (G2). The index keys them `style:<path>#<function>` (one answer per
`defineStyle(` call in the function, the range the call) and `style:<path>#<function>.<property>`
(the call that is the value of that property). The call ref takes `line` and `column` from the
answer's range start, `name` from the key after `#`. The edit and the broken guard work as for a
const: `anchorKey` gives the `style:` key back. A `defineStyle(board)` with no object literal has no
block (`no-key`).

```ts
const ref = { kind: "call", name: "roundStylesOf.icon", line: 358, column: 11 } as const;
await writeNumber(link.files, "features/ui/kit.tsx", loaded, { ref, path: "width", raw: "40" }, 41);
```

Limit: the scanner does not recognise regex literals. Style files have none.

### `project.ts`

The index is the only source of code locations (amendment N). No crawl, no kebab rule, no list.

| Export | Signature | What |
|---|---|---|
| `findFresh` | `(files, key) => Promise<FreshFound \| undefined>` | `find(key)[0]`, then `read(path)`. A read version other than `hash` asks once more. Never throws. |
| `findAllFresh` | `(files, key) => Promise<FreshAnswers \| undefined>` | Like `findFresh`, with every answer in the file of the first one: the calls of a style function (G2). |
| `textStylesFile` | `(state) => string \| undefined` | The file with the most `textStyle:` keys; a tie takes the first sorted path. |
| `usedIn` | `(state, path) => readonly string[]` | The use paths of every key defined in `path`: once each, sorted, without `path`. |
| `manifestOf` | `(state) => string \| undefined` | `ProjectState.manifest` when on. The manifest has no other source. |
| `projectOffText` | `(state) => string \| undefined` | "Project index is off: <reason>"; undefined when on. |
| `notFoundText` | `(state, key) => string` | The off text, else "Not in the project index: <key>". |
| `NOT_IN_INDEX_TEXT` | `string` | "Not in the project index". |

`findFresh` answers undefined for an unknown key (`[]`), a client without `find`, a rejected
`find` and a rejected read. The view then shows `notFoundText(link.project(), key)`.

```ts
const fresh = await findFresh(link.files, "node:board/merge");
if (fresh === undefined) return notFoundText(link.project(), "node:board/merge");
openCode(fresh.found.path, fresh.found.line, fresh.text); // "nodes/merge.ts", 17
```

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
| `duration` | `camera`, `zoom`, `follow`, `walk`, `resize`, `toast` → `--duration-*`. |
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
| `rectSourceOf` | `(manifest) => "game.locate" \| "game.rect" \| undefined` | Where element rects are read: `game.locate` when listed (game 0.4), else `game.rect` (game 0.1); undefined when neither is (`RECT_SOURCE_IDS`). |
| `drawnRect` | `(natural, fits) => PageRect` | The drawn rect through the fit chain. |
| `transformedRect` | `(rect, parent, style, fit) => PageRect` | The drawn rect with the rest transform of the style on top (below). |
| `elementAt` | `(scene, point) => SceneNode \| undefined` | Topmost visible node at a point; skips alpha 0 and `visible: false`. |
| `isLayoutOnly` | `(node) => boolean` | A ui screen, column, row, stack or spacer with no fill, stroke, nine-slice or shape. `elementAt` looks through it; gameView's Reference proxies put it under the drawing nodes. |
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

Rest transform (finding 3). A ui node's rect is the box it is drawn in at rest, not its layout box.
`transformedRect` ports the game's `pivotOf` and `restTransform` (`ui/layout/motion.ts`):

- The pivot comes from `style.origin`: the centre by default, `"top"`, `"topLeft"`, or `{ x, y }` fractions of the box.
- `offsetX` and `offsetY` move the box. They are scaled by `fit`, the scale the node is drawn at.
- `scale` and `rotation` (radians, clockwise) apply around the pivot. A rotation gives the axis-aligned box of the turned rect.
- A style with none of `offsetX`, `offsetY`, `scale`, `rotation` changes nothing. `origin` alone moves nothing.

`buildScene` applies it after `drawnRect`, and composes it through the ancestors: a child of a
scaled or turned node is scaled or turned with it. Live motion (a popup's enter, a swing) is not
modelled. Projection entities hosted by a transformed ui node keep the host's untransformed frame.

```ts
transformedRect({ x: 100, y: 200, w: 300, h: 100 }, undefined, { scale: 1.2, origin: "top" }, 1);
// { x: 70, y: 200, w: 360, h: 120 }
```

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

### `side-panel/`

The barrel `side-panel/index.ts` exports:

| Export | Signature | What |
|---|---|---|
| `SidePanel` | Preact component, `SidePanelProps` | A view's side panel. |
| `useSidePanel` | `(id) => SidePanelHandle` | `{ closed, expanded, show, toggle }` for the view's reopen button. Re-renders on every change. |
| `sidePanelState` | `(id) => SidePanelState` | `{ width, collapsed, closed, overlay, drawer }`, outside a component (a palette item's `when`). |
| `showSidePanel` | `(id) => void` | Shows the panel expanded: reopens it and opens the drawer, so a panel reopened below `overlayBelow` mounts as an open drawer. |
| `toggleSidePanel` | `(id) => void` | Collapses or expands it (the drawer in overlay mode); shows it when closed. The view binds `\`. |

Props:

| Prop | Type | Meaning |
|---|---|---|
| `id` | `string` | Persistence key, e.g. `"flow.inspector"`. |
| `side` | `"start" \| "end"` | The edge of the view it docks to. |
| `title` | `string` | Head and rail text; the panel's `aria-label`. |
| `defaultWidth`, `minWidth`, `maxWidth` | `number` | px. The width until the person resizes it, and the bounds. |
| `overlayBelow` | `number`, optional | Container width in px below which the panel floats as a drawer. Never without it. |
| `open`, `onOpenChange` | optional | Controlled open. Uncontrolled (the stored `closed`) when `open` is absent. Close calls `onOpenChange(false)` in both modes. |

Behaviour:

- Resize: a 6 px handle on the inner edge, `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow` = width. A pointer drag clamps to [min, max] and stores on release. ←/→ on the focused handle step 16 px. A double-click goes back to `defaultWidth`.
- Collapse: the head button (`data-action="collapse"`, `›` on an end panel, title "Collapse (\)") gives a 32 px rail with the title written down it and `data-action="expand"`. The content stays mounted, hidden.
- Close: the head `×` (`data-action="close"`) renders nothing. The view shows `data-action="reopen-<id>"` in its toolbar while `useSidePanel(id).closed`, and registers the palette item "Show <title>" with `showSidePanel(id)`.
- Overlay: when the parent container is narrower than `overlayBelow` (measured at mount and by `ResizeObserver`), the expanded panel floats over the content: `position: absolute`, at the inline edge, shadow, max 92 % of the container. It starts collapsed unless `showSidePanel` opened its drawer (the reopen button, the palette item); turning narrow on a resize shuts the drawer. The docked choice is kept for when the container grows. Width 0 (a hidden workspace) keeps the mode. The parent container must be `position: relative`.
- Persistence: localStorage `moku-editor:panel:<id>` holds `{ width, collapsed, closed }` (`width` absent until resized). Every access is in try/catch; while storage fails, the panel keeps its state in memory. Overlay mode and the drawer are never stored.
- Markup: `<aside data-side-panel="<id>" data-side data-state="expanded|collapsed" data-overlay? data-dragging?>`, parts `handle`, `head` (`title`), `rail` (`rail-title`), `body`.
- CSS: `side-panel/side-panel.css`, one `@scope ([data-side-panel])`, child combinators only. Density tokens `--space-*` and `--row-h`; the transition uses `--duration-resize`, none under reduced motion.

```tsx
<div data-flow="workspace">
  <Canvas />
  <SidePanel id="flow.inspector" side="end" title="Inspector" defaultWidth={320} minWidth={220} maxWidth={560} overlayBelow={600}>
    <Inspector ctx={ctx} />
  </SidePanel>
</div>

// The toolbar's reopen button, and the palette item.
const inspector = useSidePanel("flow.inspector");
inspector.closed && <button type="button" data-action="reopen-flow.inspector" onClick={inspector.show}>Inspector</button>;
palette.add({ id: "flow:show-inspector", label: "Show Inspector", run: () => showSidePanel("flow.inspector") });
```

### `editor-url.ts`

`editorUrlOf(template, root, path, line?) => string | undefined`. Pure. `{path}` is the encoded
`root/path`, `{line}` defaults to 1. `undefined` when `template` or `root` is empty. The server
never spawns a process.

```ts
editorUrlOf("vscode://file/{path}:{line}", "/Users/alex/game", "nodes/merge.ts", 12);
// "vscode://file/Users/alex/game/nodes/merge.ts:12"
```

### `editable.ts`

`isEditableTarget(target) => boolean`. Pure. True for an input, a textarea, a select, or an
element inside `[contenteditable]` (not `contenteditable="false"`). False for `null` and for a
target that is no element. The workspace keymap lets single keys reach such a field; gameView
leaves Escape to it.

```ts
isEditableTarget(document.createElement("input")); // true
isEditableTarget(null); // false
```
