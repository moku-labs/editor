# stateView

> Standard plugin (tools core). The State workspace (design-context §6 A4).

It shows the committed state of the connected game in three columns:

- **Player**: the `player` tree of `game.model`. Rows changed by the last commit are highlighted.
- **Last commit**: the patch list, with the **Session** tree below it.
- **Runner**: path, flow · node, stack, link, tainted, last edge, and what the gate waits for.

The title reads "State · player and session at frame N · last commit ~fM".

## Where the commit comes from

The engine gives the editor no commit patches. stateView derives them (R4):

1. A tracker watches `game.model` for the whole app, not only while the panel shows.
2. The first value of a session is the baseline. It is never a commit.
3. Each later value is diffed against the baseline (`diffJson` over `player`, then `session`).
4. A value equal to the baseline is no commit. A reconnect re-sends the same snapshot.
5. The commit frame is the heartbeat frame when the value arrived. It is shown as `~f1503`, because no source reports the real one.

A commit made while another workspace is shown is still the last commit when the user comes back.
Follow-up F-S1 (`@moku-labs/game`): a `game.commit` source with frame, cause, roots and patches. stateView then watches it instead of diffing.

## API

`app.stateView` is `StateViewApi`. The full contract is on the type in `types.ts`.

| Member | What |
|---|---|
| `lastCommit()` | The last derived commit of the session: `seq`, `frame`, `at`, `patches`, `truncated`, `changed`, `ancestors`, `rngChanged`. `undefined` before the first one. |
| `note()` | Why there is no commit: `"none"` (never connected), `"waiting"`, `"reloaded"`. |
| `onCommit(fn)` | Calls `fn` after every tracker change: commit, reset, taint, graph, expansion. Returns an unsubscribe. Calling it twice is a no-op. |
| `tainted()` | The last known taint. `undefined` while unknown. |
| `graph()` | The cached `game.graph`, read once per manifest. |
| `expanded(pointer, depth)` | Open state of a tree row: the stored override, else `depth < expandDepth`. |
| `setExpanded(pointer, open)` | Stores the override and notifies. |
| `expandAll(root, open)` | Expand all / Collapse all on `"player"` or `"session"` of the current baseline. |

```ts
const app = createApp({});
await app.start();
// after the tap on the sawmill at frame 1503
app.stateView.lastCommit()?.patches.map(patch => patch.pointer);
// ["/player/merge/board/items/0", "/player/merge/energy/value",
//  "/player/merge/generators/sawmill/charges", "/player/merge/nextItemId"]
app.stateView.lastCommit()?.frame; // 1503
```

A patch has the JSON Patch shape plus the old value:
`{ op, root, path, pointer, value?, was? }`.
Arrays: one insert or one removal is one patch. Other array changes go index by index, and removals come from the highest index down.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `expandDepth` | `2` | Tree levels open by default under `player` and `session`. `0` shows only the root row. |
| `maxPatches` | `200` | Most patches kept per commit. The rest is counted as "+N more patches". |
| `pageSize` | `100` | Children shown per array or object before a "Show N more" row. |

## Events

- **Emits:** nothing. stateView declares no events.
- **Hooks** (global tools events, R4):
  - `link:status`: `lost` resets the tracker with the note `reloaded`. Other kinds do nothing.
  - `workspace:ran`: a settled run stores `result.state.tainted` at once. A failed run does nothing.
- **Requires:** `linkPlugin` (watches, `read("game.graph")`, `onManifest`, `session()`, `status()`), `panelsPlugin` (`register`).

## Lifecycle

- **onInit:** registers the panel `state` (workspace `state`). Sources: `game.model`, `game.position`, `game.history {last: 1}`.
- **onStart:** subscribes three things:
  - `link.onManifest`: a manifest of a new session resets the tracker (`waiting`). Every manifest reloads `game.graph`.
  - `link.watch("game.model")`: feeds the tracker.
  - `link.watch("game.tainted")`: the taint (R6). The link re-sends both watches after a reconnect or a session change.
- **onStop:** drops both watches and the manifest listener, and clears the UI listeners.

Nothing polls. `game.model` and `game.tainted` are watched, never read.

## UI

- `view/StateView.tsx`: title and three-column grid.
- `view/JsonTree.tsx`: ARIA tree with roving tabindex. ↑/↓ move, → opens or moves to the first child, ← closes or moves to the parent, Home/End jump. A changed row has `data-changed` and a "was 8" or "added" chip. Its ancestors have `data-has-change`.
- `view/PatchList.tsx`: op tags (`add` ok, `replace` acc, `remove` err), pointer, old → new value cut at 120 chars with the full value in `title`.
- `view/RunnerCard.tsx`: the stack comes from `stackOf(path, graph, position.flow)`, or the raw path. No running/mode rows: no source reports them yet (F-S1).

Each component has one sheet, `@scope ([data-panel="state"] [data-part="…"])`.
No sheet wraps itself in `@layer`: `pages/page/index.css` imports them in `layer(components)` (R3, R7).
Styles use `data-*` attributes and the workspace tokens only. No class selectors.
