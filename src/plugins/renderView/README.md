# renderView

> Standard plugin (tools core) — the Render workspace (design A3, C9).

Title "Render · game.render · frame N", six metric tiles, the render tree card and the textures
card on the left, the Bundles, Pools and Release log cards on the right. Hovering a tree row or a
texture row draws a pink box (`--pick-tree`) around the element over the game frame, in
renderView's own root inside `workspace.gameFrame().overlay()`, so it shows in the pinned preview.

renderView depends on no other view (R4). It hooks the global `workspace:reveal` (gameView's
"Show in render tree") and emits the global `workspace:inspect` from the C9 "Inspect in Game"
button (R9).

## Data path (R6)

| Watch | When | Why |
|---|---|---|
| `game.render`, `game.assets` | the whole session (onStart) | FPS samples and the release log need every change since the editor connected |
| `game.effects` | the whole session, only while the manifest lists it (game 0.0.3) | particles, emitters and filters for the Scene tile |
| `game.ui`, `game.entities`, `game.projections` | only while Render is shown | entities can be large |

The bridge re-reads each watched frame source once per heartbeat and sends changes only. No timer
reads a frame source. A burst of scene values builds one scene per animation frame with the shared
`panels/shared/scene` module (R8). `game.rect` of the first keyed ui element calibrates the scene
once per session and again after a device change. The asset manifest is read through
`link.files.read` from the first `manifestPaths` entry that holds a version-1 manifest.

`game.effects` follows `link.onManifest`: a manifest that lists it starts one watch, a manifest
without it (a game older than 0.0.3) stops the watch and clears the value, and a lost session
keeps it. The start is at once: link sends a watch added inside a manifest listener once per
attach. A 0.0.3 game without the effects plugin still lists the source:
its read fails and link logs one `link:watch-failed { id: "game.effects" }`, like `game.render`
on a screenless game. A value of the wrong shape warns once and the last good value stays.

## API

| Method | What it does |
|---|---|
| `refresh(): Promise<void>` | Re-reads the asset manifest and the calibration. Not a poll. Skipped while the link is not live or paused. |
| `snapshot(): RenderSnapshot` | Tiles, visible tree rows, texture rows (filter and sort applied), bundles, pools, release log. Copies. |
| `reveal(ref)` | Shows Render, opens the ancestors, selects the row. Waits for the first scene when Render was hidden. |
| `highlight(ref \| undefined)` | Pink box around the element over the game frame; `undefined` clears it. |
| `sortTextures(key)` | Same key flips the direction; a new key sorts numbers descending, text ascending. |
| `filterBundle(bundle)` | `"all"` or a bundle name. |

```ts
app.workspace.show("render");
app.renderView.snapshot().tiles.drawCalls; // { kind: "absent" } in a production build
app.renderView.snapshot().tiles.scene?.effects; // { particles: 18, emitters: 1, filters: 24, renderPasses: 49 }
app.renderView.reveal({ kind: "entity", id: 3_145_728 });
app.renderView.highlight({ kind: "ui", path: "boardScreen/boardSlot" });
```

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `fpsSamples` | `60` | FPS samples kept for the sparkline, one per delivered `game.render` value. |
| `releaseLogMax` | `50` | Release log entries kept, newest first. |
| `manifestPaths` | `["manifest.json", "public/manifest.json", "web/manifest.json"]` | Where the asset manifest may live, tried in order. |

## Events

- **Emits:** `workspace:inspect { ref }` (global tools event, R9) from "Inspect in Game".
- **Hooks:** `workspace:changed` (scene watches on and off, refresh once per session),
  `link:status` (keep data while silent or lost, clear the session data and the effects after a
  session change, clear all on empty), `workspace:reveal` (`reveal(ref)`).

## Derivations

| Output | Rule |
|---|---|
| Draw calls tile | The `game.render` counter, a dev-build counter on any backend; without it "Not counted in a production build". Sub-line "R render pass(es)" when `game.render` reports `renderPasses` (game 0.0.3), else "game.render" or "game.render reports no draw counter". |
| Scene tile | Entities, "V display objects · P pooled", and a third line "P particles · E emitters · F filters" from `game.effects`; on an older game "Particles and filters are not reported (follow-up F-R1)". |
| Texture rows | Catalogue textures whose bundle is in `game.assets`; GPU MB = w × h × 4 / 2^20. |
| Texture use | Per scene: referenced keys are in use; a key seen before and not referenced now is "unused since fF"; a key never seen is "not seen since f<firstFrame>". Precision is one delivered value, only while Render is shown. |
| Release log | A bundle in the previous `game.assets` value and not in this one, at the frame of the last `game.render`. |
| Tree rows | Depth first over the scene roots, only through open nodes. The roots open on the first scene of a session. |

## Not reported by the game (follow-ups in @moku-labs/game)

- **F-R1:** render phase split, JS heap and per-pool counts. The frame time tile shows one bar;
  the heap tile reads "Not reported". Particles, emitters, filters and render passes come from
  `game.effects` since game 0.0.3.
- **F-R2:** `game.textures` (size and last use per texture). Rows come from the committed asset
  manifest; without one the card says so.
- **F-R3:** `assets:bundle-unloaded` with frame and reason. The release log is a diff, its frame is
  approximate ("≈fN").
- **F-G1:** a display-tree source. Tree types are ui tags and entity display kinds, not Pixi
  classes.
- Draw calls are counted in a dev build only: in a production build the tile reads "Not counted
  in a production build".

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
