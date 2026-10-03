# renderView

> Standard plugin of the **tools** core (`createToolsPlugin`). The Render workspace (design A3, C9).

Title "Render · game.render · frame N", six metric tiles, the render tree card and the textures
card on the left, the Bundles, Pools and Release log cards on the right.
Hovering a tree row or a texture row draws a pink box (`--pick-tree`) around the element over the game frame.
The box lives in renderView's own root inside `workspace.gameFrame().overlay()`, so it shows in the pinned preview.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `fpsSamples` | `number` | `60` | FPS samples kept for the sparkline, one per changed `game.render` value. |
| `releaseLogMax` | `number` | `50` | Release log entries kept, newest first. |
| `manifestPaths` | `readonly string[]` | `["manifest.json", "public/manifest.json", "web/manifest.json"]` | Where the asset manifest may live, tried in order through `link.files.read`. |

## API

`app.renderView` is `RenderViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `refresh` | `() => Promise<void>` | Re-reads the asset manifest and the `game.rect` calibration. Not a poll. Does nothing while the link is not live or paused. Never rejects. |
| `snapshot` | `() => RenderSnapshot` | `{ frame, tiles, tree, textures, bundles, pools, releases }`. Texture rows have the filter and sort applied. Copies. |
| `reveal` | `(ref: ElementRef) => void` | Shows Render, opens the ancestors, selects the row and scrolls it into view. Waits for the first scene when Render was hidden. |
| `highlight` | `(ref: ElementRef \| undefined) => void` | Pink box around the element over the game frame. `undefined` clears it. A ref without a rect draws nothing. |
| `sortTextures` | `(key: TextureSortKey) => void` | The same key flips the direction. A new key sorts numbers descending, text ascending. |
| `filterBundle` | `(bundle: string) => void` | `"all"` or a bundle name. |

`TextureSortKey` is `"key" | "bundle" | "size" | "gpuMb" | "fileMb" | "use"`.

```ts
const { tiles } = app.renderView.snapshot();
tiles.drawCalls; // { kind: "absent" } in a production build
tiles.scene?.effects; // { particles: 18, emitters: 1, filters: 24, renderPasses: 49 } on game 0.0.3

app.renderView.reveal({ kind: "entity", id: 3_145_728 });
app.renderView.snapshot().tree.find(row => row.id === "entity:3145728")?.depth; // 2

app.renderView.highlight({ kind: "ui", path: "boardScreen/boardSlot" });
app.renderView.highlight(undefined);

app.renderView.filterBundle("ui");
app.renderView.snapshot().textures.every(row => row.bundle === "ui"); // true
```

### Derivations

| Output | Rule |
|---|---|
| Draw calls tile | The `game.render` counter, a dev-build counter on any backend. Without it: "Not counted in a production build". Sub-line "R render pass(es)" when `game.render` reports `renderPasses` (game 0.0.3), else "game.render" or "game.render reports no draw counter". |
| Frame time tile | `frameMs`. One bar, no phase split. |
| Scene tile | Entities, "V display objects · P pooled", and "P particles · E emitters · F filters" from `game.effects`. On an older game: "Particles and filters are not reported (follow-up F-R1)". |
| JS heap tile | Always "Not reported". |
| Texture rows | Catalogue textures whose bundle is in `game.assets`. GPU MB = w × h × 4 / 2^20. |
| Texture use | Per scene: referenced keys are in use. A key seen before and not referenced now is "unused since fF". A key never seen is "not seen since f<firstFrame>". Precision is one delivered value, only while Render is shown. |
| Pools | One row "All pools". No per-pool counts. |
| Release log | A bundle in the previous `game.assets` value and not in this one, at the frame of the last `game.render`. Shown as "≈fN". |
| Tree rows | Depth first over the scene roots, only through open nodes. The roots open on the first scene of a session. |

## Events

renderView declares no events. It uses the global tools events (R4, R9).

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | `workspace:inspect` | `{ ref }` | The C9 "Inspect in Game" button. gameView hooks it. |
| Hooks | `workspace:changed` | `{ ws }` | `render`: scene watches on, refresh once per session. Other: scene watches off, box cleared. |
| Hooks | `link:status` | `{ status, session? }` | Silent or lost: data kept. A new session while live or paused: session data and effects cleared. `empty`: everything cleared. |
| Hooks | `workspace:reveal` | `{ ref }` | gameView's "Show in render tree": `reveal(ref)`. |

Log events: `renderView: unexpected source shape` (warn, once per wrong value), `renderView: calibration failed` (warn).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch` of the game sources, `read("game.rect")`, `files.read` of the manifest, `onManifest`, `status()` |
| `workspacePlugin` | `show("render")`, `active()`, `onPrefs` (device change), `gameFrame().overlay()`, `palette.add` |
| `panelsPlugin` | `register` the Render panel |

Shared module: `panels/shared/scene` builds the scene from `game.ui`, `game.entities` and `game.projections` (R8).
renderView depends on no other view (R4).

### Data path (R6)

| Watch | When | Why |
|---|---|---|
| `game.render`, `game.assets` | The whole session (onStart). | FPS samples and the release log need every change since the editor connected. |
| `game.effects` | The whole session, only while the manifest lists it (game 0.0.3). | Particles, emitters and filters for the Scene tile. |
| `game.ui`, `game.entities`, `game.projections` | Only while Render is shown. | Entities can be large. |

- The bridge re-reads each watched frame source once per heartbeat and sends changes only. No timer reads a frame source.
- A burst of scene values builds one scene per animation frame.
- `game.rect` of the first keyed ui element calibrates the scene once per session and again after a device change.
- The asset manifest is read from the first `manifestPaths` entry that holds a version-1 manifest.
- `game.effects` follows `link.onManifest`. A manifest that lists it starts one watch. A manifest without it stops the watch and clears the value. A lost session keeps it.
- A 0.0.3 game without the effects plugin still lists the source. Its read fails and link logs one `link:watch-failed { id: "game.effects" }`.
- A value of the wrong shape warns once and the last good value stays.

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the Render panel. |
| `onStart` | Starts the session watches (`game.render`, `game.assets`, `game.effects` by manifest). Recalibrates on a device or orientation change (`workspace.onPrefs`). Runs the `workspace:changed` logic at once when Render is already shown. |
| `onStop` | Stops every watch and the effects watch. Removes the overlay root and the palette items. Clears the listeners. |

## Usage

```ts
const app = createApp({ pluginConfigs: { renderView: { fpsSamples: 120, releaseLogMax: 20 } } });
await app.start();
app.workspace.show("render");
await app.renderView.refresh();
app.renderView.snapshot().textures.length; // 3: the textures of the loaded bundles
```

Another view reveals an element without depending on renderView:

```ts
ctx.emit("workspace:reveal", { ref: { kind: "entity", id: 3_145_728 } });
```

## Integration

- **gameView** emits `workspace:reveal` from "Show in render tree" and hooks `workspace:inspect` from "Inspect in Game".
- **workspace** palette: one item per catalogue texture, group "Textures". Running it shows Render, filters to the bundle and reveals the first node that draws the texture.
- **workspace** game frame: the pink box is drawn in renderView's own overlay root, in device space.

## Files

| File | Role |
|---|---|
| `index.ts` | Wiring. |
| `types.ts` | Config, state, rows, tiles, snapshot, api, ctx, hooks. |
| `state.ts` | State factory, `notify`, `subscribe`. |
| `api.ts` | The api over `actions.ts`, `derive.ts`, `watch.ts`. |
| `watch.ts` | Tracker, effects and scene watches, scene builds, calibration, catalogue, refresh. |
| `derive.ts` | Pure derivations. |
| `format.ts` | Pure tile texts, sparkline points, tags. |
| `guards.ts` | `asRenderStats`, `asAssetsUsage`, `asEffectsStats`. |
| `actions.ts` | Reveal, select, open, sort, filter, highlight, inspect, palette items. |
| `overlay.ts` | The box root in the game frame's overlay. |
| `handlers.ts` | The three hooks. |
| `lifecycle.ts` | onInit, onStart, onStop. |
| `panel.tsx`, `components/` | The Render panel and its Preact components. |
| `styles/` | `render.css` and its `@scope` sheets (no `@layer` wrapper, R7). |

## Limits and game follow-ups

| Limit | Follow-up in `@moku-labs/game` |
|---|---|
| No render phase split, no JS heap, no per-pool counts. | F-R1. Particles, emitters, filters and render passes come from `game.effects` since game 0.0.3. |
| Texture rows come from the committed asset manifest. Without one the card says so. Texture use is approximate. | F-R2: `game.textures` with size and last use per texture. |
| The release log is a diff. Its frame is approximate ("≈fN"). No reason. | F-R3: `assets:bundle-unloaded` with frame and reason. |
| Tree types are ui tags and entity display kinds, not Pixi classes. | F-G1: a display-tree source. |
| Draw calls are counted in a dev build only. | None. |
