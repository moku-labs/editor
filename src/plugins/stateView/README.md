# stateView

> Standard plugin of the **tools** core (`createToolsPlugin`). The State workspace: player and session trees, the last commit and the runner.

It shows the committed state of the connected game in three columns:

- **Player**: the `player` tree of `game.model`. Rows changed by the last commit are highlighted.
- **Last commit**: the patch list, with the **Session** tree below it.
- **Runner**: path, flow · node, stack, link, tainted, last edge, and what the gate waits for.

The title reads "State · player and session at frame N · last commit ~fM".

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `expandDepth` | `number` | `2` | Tree levels open by default under `player` and `session`. `0` shows only the root row. |
| `maxPatches` | `number` | `200` | Most patches kept per commit. The rest is counted as "+N more patches". |
| `pageSize` | `number` | `100` | Children shown per array or object before a "Show N more" row. |

## API

`app.stateView` is `StateViewApi` (`types.ts`).

| Member | Signature | What |
|---|---|---|
| `lastCommit` | `() => LastCommit \| undefined` | The last derived commit of the session. `undefined` before the first one. |
| `note` | `() => TrackerNote` | Why there is no commit: `"none"` (never connected), `"waiting"` (connected, no commit yet), `"reloaded"` (the game page reloaded). |
| `onCommit` | `(fn: () => void) => () => void` | Calls `fn` after every tracker change: commit, reset, taint, graph, expansion. The unsubscribe is idempotent. |
| `tainted` | `() => boolean \| undefined` | The last known taint. `undefined` while unknown. |
| `graph` | `() => Json \| undefined` | The cached `game.graph`, read once per manifest. |
| `expanded` | `(pointer: string, depth: number) => boolean` | Open state of a tree row: the stored override, else `depth < expandDepth`. |
| `setExpanded` | `(pointer: string, open: boolean) => void` | Stores the override and notifies. |
| `expandAll` | `(root: StateRoot, open: boolean) => void` | Expand all / Collapse all on `"player"` or `"session"` of the current baseline. Notifies. |

`LastCommit` is `{ seq, frame, at, patches, truncated, changed, ancestors, rngChanged }`.
A `StatePatch` is the JSON Patch shape plus the old value: `{ op, root, path, pointer, value?, was? }`.
Arrays: one insert or one removal is one patch. Other array changes go index by index, removals from the highest index down.

```ts
// The player tapped the sawmill; the heartbeat said frame 1503 when the value arrived.
app.stateView.lastCommit()?.patches.map(patch => patch.pointer);
// ["/player/merge/board/items/0", "/player/merge/energy/value",
//  "/player/merge/generators/sawmill/charges", "/player/merge/nextItemId"]
app.stateView.lastCommit()?.frame; // 1503

app.stateView.note(); // "waiting" before the first tap
app.stateView.tainted(); // false

app.stateView.expanded("/player/merge", 1); // true with expandDepth 2
app.stateView.setExpanded("/player/merge/board", false);
app.stateView.expandAll("player", true);
```

### Where the commit comes from

The engine gives the editor no commit patches. stateView derives them (R4):

1. A tracker watches `game.model` for the whole app, not only while the panel shows.
2. The first value of a session is the baseline. It is never a commit.
3. Each later value is diffed against the previous one (`diffModel` over `player`, `session` and `rng`).
4. A value equal to the previous one is no commit. A reconnect re-sends the same snapshot.
5. A change of `rng` only is a commit with no patches ("rng advanced").
6. The commit frame is the heartbeat frame when the value arrived. It shows as `~f1503`, because no source reports the real one.

A commit made while another workspace is shown is still the last commit when the user comes back.

## Events

| Kind | Name | Payload | When |
|---|---|---|---|
| Declares | none | | |
| Emits | none | | |
| Hooks | `link:status` | `{ status }` | `lost` resets the tracker with the note `reloaded`. Other kinds do nothing. |
| Hooks | `workspace:ran` | the run result | A settled run stores `result.state.tainted` at once and notifies. A failed run does nothing. |

Log events: `stateView:unexpected-model` (warn), `stateView:unexpected-tainted` (warn), `stateView:graph-unavailable` (debug).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch("game.model")`, `watch("game.tainted")`, `read("game.graph")`, `onManifest`, `session()`, `status()` |
| `panelsPlugin` | `register` the `state` panel |

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the panel `state` (workspace `state`). Sources: `model: "game.model"`, `position: "game.position"`, `history: ["game.history", { last: 1 }]`. |
| `onStart` | `link.onManifest`: a manifest of a new session resets the tracker (`waiting`); every manifest reloads `game.graph`. `link.watch("game.model")` feeds the tracker. `link.watch("game.tainted")` gives the taint (R6). |
| `onStop` | Drops both watches and the manifest listener. Clears the UI listeners. |

Nothing polls. `game.model` and `game.tainted` are watched, never read.

## Usage

```ts
const app = createApp({ pluginConfigs: { stateView: { expandDepth: 3, maxPatches: 500 } } });
await app.start();

// A test or an MCP tool waits for the next commit.
const off = app.stateView.onCommit(() => {
  const commit = app.stateView.lastCommit();
  if (commit !== undefined) report(commit.patches.length);
});
off();
```

## Integration

- **link** re-sends both watches after a reconnect or a session change. A `lost` status resets the tracker.
- **workspace** emits `workspace:ran` after a command run on the tools page. stateView takes the taint from it before the `game.tainted` watch delivers.
- **panels** delivers the panel sources `game.position` and `game.history` to the Runner card.
- The Runner stack comes from `stackOf(path, graph, position.flow)` over the cached graph, or the raw path.

## View

| Part | What |
|---|---|
| `view/StateView.tsx` | Title and three-column grid. |
| `view/JsonTree.tsx` | ARIA tree with roving tabindex. ↑/↓ move, → opens or moves to the first child, ← closes or moves to the parent, Home/End jump. A changed row has `data-changed` and a "was 8" chip or an "added" tag. Its ancestors have `data-has-change`. |
| `view/PatchList.tsx` | Op tags (`add`, `replace`, `remove`), pointer, old → new value cut at 120 chars with the full value in `title`. "+N more patches", "rng advanced", or why there is no commit. |
| `view/RunnerCard.tsx` | path, flow · node, stack, link, tainted, last edge, "Gate waits for N". |

Each component has one sheet, `@scope ([data-panel="state"] [data-part="…"])`.
No sheet wraps itself in `@layer`: the page CSS entry imports them in `layer(components)` (R3, R7).
Styles use `data-*` attributes and the workspace tokens only. No class selectors.

## Limits and game follow-ups

| Limit | Follow-up |
|---|---|
| Commits are derived by diffing `game.model` snapshots. Commits in the same frame merge into one diff. | F-S1: a `game.commit` source with frame, cause, roots and patches. stateView then watches it instead of diffing. |
| The commit frame is approximate (`~fN`). | F-S1. |
| The Runner card has no `running` and `mode` rows. | F-S1: `running` and `mode` in `game.position`. |
