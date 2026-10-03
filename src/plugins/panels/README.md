# panels

> Standard plugin (tools core). The panel host of the tools page. A panel is data, and the host owns its subscriptions (design API pick 3A).

The view plugins build panels with `definePanel` and register them in their `onInit` (D-04).
For every mounted panel, panels does five things:

- It watches each declared source through `link`.
- It waits until every source delivered a first value, then renders `view(values, tools)` with Preact.
- It marks the data stale on `link:status`.
- It re-checks sources when the manifest changes.
- It unwatches everything on unmount and on stop.

Nothing in panels polls.

## Configuration

`{}`: panels has no options (contracts §5).

## API

| Method | What |
|---|---|
| `register(panel)` | Adds a `PanelSpec` from `definePanel`. Throws `[moku-editor] Panel "<id>" is already registered.` After start, a panel of a mounted workspace mounts at once and gets a palette item. |
| `run(id, input?, origin = "panel")` | Runs a command outside any render (R9): `link.run`, then the global `workspace:ran`. Resolves or rejects like `link.run`. |
| `list()` | Every registered panel, in registration order (a copy). |
| `mountInto(ws, element)` | Mounts every panel of a workspace, one `<section data-panel>` each, in registration order. The same element is a no-op. Another element moves the mount. Returns the unmount function. |

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

`tools` holds five things:

- `run`: one function per command name. Each run emits `workspace:ran` with origin `panel`.
- `status`: the link status at this render.
- `channel`: link's reads and watches. Its `run` is reported too.
- `files`: `link.files`.
- `workspace`: the workspace api.

A view never emits `workspace:ran` itself.

`definePanel` is runtime-free and exported from `"."`.
It checks each field and throws `[moku-editor] … is invalid.\n  <fix>.` when one is wrong:

- the id
- the workspace
- each source ref
- each command id
- `view`
- `compact`

A view returns any Preact element (`PanelElement` = `JSX.Element`). JSX and `h(Component, props)` both fit.

## Typing spike (11-panels): passed, typed map in use

`catalogue.ts` maps every engine door to its type. It uses type imports only.

- Each `game.<key>` source gives `Wire<ReturnType<read>>`.
- Each `game.<key>` command gives `InputOf<input>`.
- `.dev` ids and unknown ids stay `Json`.

| Step | Result (2026-10-03) |
|---|---|
| 1. Runtime: `sources[k].id === "game." + k` for every source and command | green (`catalogue.test.ts`) |
| 2. Types: Position `path: string`, history array, `merge.coins` is `Json`, `$map` / `$set` / `$error`, `run.step()` without `frames` is an error, `run.pause()` passes | green (`define-types.test.ts`) |
| 3. Bundle: no `@moku-labs/game` runtime import in `"."` | `define.ts` bundles with zero imports. The `"."` bundle has no game or preact import (scratch `bun build`). The `.d.mts` check runs with `bun run build`. |
| 4. `tsc` cost of the type test | +0.08 s check time, no "excessively deep" error |

The Json fallback is not needed.
If a later engine change breaks the map, only `catalogue.ts` changes:
`GameSourceValues` and `GameCommandInputs` become `Record<never, never>`.

## Scene spike (11-panels R8): rules 2–4 hold on merge-game

Captured from `createScreenGame` (inert renderer) on `board/awaitIntent`, then with Settings open (2026-10-03).
The captures are the fixtures `__tests__/fixtures/scene-board.txt` and `scene-settings.txt`.
`shared-scene.test.ts` runs rules 2–4 on them.

| Finding | What `shared/scene/` does |
|---|---|
| Several roots come under a synthetic `screen` root: no key, rect 0,0,0,0, popups first, topmost first. | The synthetic root is no node and adds no path segment. Its children are the roots. Paint order reverses them. This changes rule 5 ("ui roots in tree order"). |
| `boardScreen` and `boardBackground` share the rect 0,0,1080,1440, so one `Box` matches two hosts. | The key of the parent ui entity in `game.projections` picks the host (the `hud` projection lists the ui keys). A tie without a key leaves the entity unplaced. |
| Projection roots (`hud`: `Layer` only) have no `Transform` and no `Parent`. | Roots with `rect: undefined`. |
| Text-only views (`hud.coins` `coins`, `board.badges` `sawmill.count`) have no size component. | Listed under their host with `rect: undefined`. |
| On the inert renderer `game.rect` is the natural rect. | Calibration is identity. Drawn rects equal `game.rect` (`settings`, `settingsBoard`). |
| A ui image keeps its texture on its ui entity's `Sprite`, not in its style. | `texture` stays `style.nineSlice` (rule 1). `referencedTextures` has the key. |

## Mount behaviour

| `data-panel-state` | When | Line (`role="status"`) |
|---|---|---|
| `missing` | the manifest lacks a declared source (it is not watched) | "This game does not provide `<ids>`." |
| `no-game` | not every value yet, link `empty`, `connecting` or `lost` | "No game connected · this panel fills in when a game connects." |
| `waiting` | not every value yet, otherwise | empty; after 400 ms "Waiting for `<ids>`…" with `[data-spinner]`; after 5 s "No value from `<ids>` yet. Check the source input." |
| `ready` | every value received | the view, inside `PanelBoundary` |
| `error` | the view threw | "This panel failed · `<message>`", logged as `panels:view-failed`; other panels keep running |

Renders are coalesced to one per animation frame. A panel with `sources: {}` renders at once.

`data-stale` on the section follows the link status:

| Link status | `data-stale` |
|---|---|
| `silent` | `silent` |
| `lost` | `lost` |
| `empty` | `lost` |
| `connecting` | `resync` while a received value is not fresh again (clears `fresh` first) |
| `live`, `paused` | `resync` while a received value is not fresh again |

Otherwise the attribute is absent.
The fade is the workspace `[data-stale]` atom.
`panels.css` holds the section and placeholder layout in one `@scope ([data-panel])`, with no `@layer` wrapper (R7).

## Events and hooks

- **Emits:** the global `workspace:ran` (origin `panel`), once per `tools.run` call. Also once per api `run` call, with its origin.
- **Hooks:** `link:status` (stores the status and calls `setStatus` on every panel). `workspace:changed` (after start, mounts a workspace not mounted yet into `workspace.host(ws)`).
- **Lifecycle:**
  - `onStart` mounts the active workspace, adds one palette item per panel (group Panels) and subscribes `link.onManifest`.
  - `onStop` unmounts every panel (every unwatch) and runs the removers.
- **Requires:** `linkPlugin`, `workspacePlugin`.

## Shared view modules (`shared/`)

These are plain modules for the views, imported by relative path. They are not exported from `"."` and they are not a plugin api (R4, D-16).

| Module | Used by |
|---|---|
| `style-edit.ts` | flowView, gameView |
| `notes.ts` | flowView, gameView |
| `highlight.ts` | flowView, filesView |
| `tokens.ts` | every view |
| `scene/` | gameView, renderView |
| `editor-url.ts` | flowView, filesView |

Their full rules are in `.planning/specs/11-panels.md` ("Shared modules").
