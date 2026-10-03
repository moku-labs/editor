/**
 * @file renderView plugin — the pure derivations of the Render workspace: tiles, texture rows and
 * their use, bundle rows, pools, the release log and the visible tree rows.
 */
import type { SceneNode, SceneSnapshot } from "../panels/shared/scene";
import type {
  AssetsUsage,
  BundleRow,
  MetricTiles,
  ReleaseEntry,
  RenderSnapshot,
  RenderStats,
  RenderViewState,
  TextureRow,
  TextureSortKey,
  TextureUse,
  TreeRow
} from "./types";

/**
 * The sort keys whose values are text (sorted ascending first).
 */
const TEXT_KEYS: ReadonlySet<TextureSortKey> = new Set(["key", "bundle", "use"]);

/**
 * The sort rank of each texture use: in use first, then unused, then never seen.
 */
const USE_RANK: Readonly<Record<TextureUse["kind"], number>> = {
  "in-use": 0,
  "unused-since": 1,
  "not-seen": 2
};

/**
 * Rounds to 2 decimals.
 *
 * @param value - A number.
 * @returns The rounded number.
 * @example
 * ```ts
 * round2(5.7312); // 5.73
 * ```
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Records the textures one scene uses at its frame: a referenced key is seen now; a key seen
 * before that is not referenced now becomes unused since this frame (once). Sets firstFrame when
 * no game.render came yet.
 *
 * @param state - renderView state (`seen`, `firstFrame`).
 * @param scene - The scene just built.
 * @example
 * ```ts
 * updateTextureUse(ctx.state, scene); // ctx.state.seen.get("board.cell") → { lastSeen: 1841, unusedSince: undefined }
 * ```
 */
export function updateTextureUse(state: RenderViewState, scene: SceneSnapshot): void {
  const { frame, referencedTextures } = scene;

  state.firstFrame ??= frame;
  for (const key of referencedTextures) {
    state.seen.set(key, { lastSeen: frame, unusedSince: undefined });
  }
  for (const [key, entry] of state.seen) {
    if (!referencedTextures.has(key) && entry.unusedSince === undefined) {
      state.seen.set(key, { lastSeen: entry.lastSeen, unusedSince: frame });
    }
  }
}

/**
 * The use of one texture from the frames it was seen at.
 *
 * @param state - renderView state (`seen`, `firstFrame`).
 * @param key - The texture key.
 * @returns in-use, unused-since F, or not-seen since firstFrame.
 * @example
 * ```ts
 * textureUseOf(ctx.state, "ui.hud-pill"); // { kind: "unused-since", frame: 212 }
 * ```
 */
function textureUseOf(state: RenderViewState, key: string): TextureUse {
  const entry = state.seen.get(key);

  if (entry === undefined) return { kind: "not-seen", since: state.firstFrame ?? 0 };
  if (entry.unusedSince === undefined) return { kind: "in-use" };
  return { kind: "unused-since", frame: entry.unusedSince };
}

/**
 * Every texture of the catalogue whose bundle is loaded now (in game.assets), with its use.
 * Catalogue order; no filter, no sort.
 *
 * @param state - renderView state.
 * @returns The rows; empty without a catalogue or without game.assets.
 * @example
 * ```ts
 * textureRowsOf(ctx.state).map(row => row.key); // ["board.board-tray", "board.cell", "ui.hud-pill"]
 * ```
 */
export function textureRowsOf(state: RenderViewState): TextureRow[] {
  const { catalogue, assets } = state;
  if (catalogue === null || catalogue === undefined || assets === undefined) return [];

  const loaded = new Set(assets.bundles.map(bundle => bundle.name));
  const rows: TextureRow[] = [];
  for (const texture of catalogue.textures.values()) {
    if (!loaded.has(texture.bundle)) continue;
    rows.push({ ...texture, use: textureUseOf(state, texture.key) });
  }
  return rows;
}

/**
 * The value a row sorts by for one key.
 *
 * @param row - A texture row.
 * @param key - The sort key.
 * @returns A number or a text.
 * @example
 * ```ts
 * sortValueOf(row, "size"); // 1048576 for 1024×1024
 * ```
 */
function sortValueOf(row: TextureRow, key: TextureSortKey): number | string {
  switch (key) {
    case "key": {
      return row.key;
    }
    case "bundle": {
      return row.bundle;
    }
    case "size": {
      return row.width * row.height;
    }
    case "gpuMb": {
      return row.gpuMb;
    }
    case "fileMb": {
      return row.fileMb;
    }
    case "use": {
      return USE_RANK[row.use.kind];
    }
  }
}

/**
 * Compares two rows by a key and a direction; ties by texture key ascending.
 *
 * @param first - A row.
 * @param second - Another row.
 * @param table - The sort key and direction.
 * @param table.sort - The sort key.
 * @param table.dir - 1 ascending, -1 descending.
 * @returns Negative, zero or positive.
 * @example
 * ```ts
 * rows.toSorted((a, b) => compareRows(a, b, { sort: "gpuMb", dir: -1 }));
 * ```
 */
function compareRows(
  first: TextureRow,
  second: TextureRow,
  table: { readonly sort: TextureSortKey; readonly dir: 1 | -1 }
): number {
  const a = sortValueOf(first, table.sort);
  const b = sortValueOf(second, table.sort);
  const order =
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return order === 0 ? first.key.localeCompare(second.key) : order * table.dir;
}

/**
 * The rows of the textures table: the loaded textures, the bundle filter applied, sorted.
 *
 * @param state - renderView state (`table`).
 * @returns The visible rows.
 * @example
 * ```ts
 * visibleTextureRows(ctx.state)[0]?.key; // "ui.hud-pill": the largest GPU MB first
 * ```
 */
export function visibleTextureRows(state: RenderViewState): TextureRow[] {
  const { table } = state;
  return textureRowsOf(state)
    .filter(row => table.bundle === "all" || row.bundle === table.bundle)
    .toSorted((first, second) => compareRows(first, second, table));
}

/**
 * The sort after a header click: the same key flips; a new key sorts numbers descending and text
 * ascending.
 *
 * @param table - The current sort.
 * @param table.sort - The current key.
 * @param table.dir - The current direction.
 * @param key - The clicked column.
 * @returns The next sort.
 * @example
 * ```ts
 * nextSort({ sort: "gpuMb", dir: -1 }, "key"); // { sort: "key", dir: 1 }
 * ```
 */
export function nextSort(
  table: { readonly sort: TextureSortKey; readonly dir: 1 | -1 },
  key: TextureSortKey
): { sort: TextureSortKey; dir: 1 | -1 } {
  if (table.sort === key) return { sort: key, dir: table.dir === 1 ? -1 : 1 };
  return { sort: key, dir: TEXT_KEYS.has(key) ? 1 : -1 };
}

/**
 * Texture rows per bundle, for the bundle chips.
 *
 * @param rows - The loaded texture rows.
 * @returns Bundle → count, in row order.
 * @example
 * ```ts
 * bundleCounts(textureRowsOf(ctx.state)); // Map { "board" => 2, "ui" => 1 }
 * ```
 */
export function bundleCounts(rows: readonly TextureRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.bundle, (counts.get(row.bundle) ?? 0) + 1);
  return counts;
}

/**
 * The rows of the bundles card: game.assets bundles with the file numbers of the catalogue and
 * the share of the largest bundle.
 *
 * @param state - renderView state.
 * @returns The rows; empty without game.assets.
 * @example
 * ```ts
 * bundleRowsOf(ctx.state)[0]; // { name: "board", tier: "scene", mb: 4, files: 2, fileMb: 1.728, share: 1 }
 * ```
 */
export function bundleRowsOf(state: RenderViewState): BundleRow[] {
  const { assets, catalogue } = state;
  if (assets === undefined) return [];

  const largest = Math.max(0, ...assets.bundles.map(bundle => bundle.mb));
  return assets.bundles.map(bundle => {
    const known = catalogue?.bundles.get(bundle.name);
    return {
      name: bundle.name,
      tier: bundle.tier,
      mb: bundle.mb,
      files: known?.files,
      fileMb: known?.fileMb,
      share: largest > 0 ? bundle.mb / largest : 0
    };
  });
}

/**
 * The bundles gone from game.assets since the previous value, as release-log entries at a frame.
 *
 * @param previous - The bundles of the previous value.
 * @param next - This value.
 * @param frame - The frame of the last game.render.
 * @returns The entries, in the previous value's order.
 * @example
 * ```ts
 * releasesOf(new Map([["home", { tier: "scene", mb: 2.5 }]]), { textureMb: 0, budgetMb: 192, bundles: [] }, 1841);
 * // [{ frame: 1841, bundle: "home", tier: "scene", mb: 2.5 }]
 * ```
 */
export function releasesOf(
  previous: ReadonlyMap<string, { tier: string; mb: number }>,
  next: AssetsUsage,
  frame: number
): readonly ReleaseEntry[] {
  const present = new Set(next.bundles.map(bundle => bundle.name));
  const entries: ReleaseEntry[] = [];
  for (const [bundle, { tier, mb }] of previous) {
    if (!present.has(bundle)) entries.push({ frame, bundle, tier, mb });
  }
  return entries;
}

/**
 * Appends a node and, when it is open, its children depth first.
 *
 * @param scene - The scene.
 * @param id - The node id.
 * @param depth - Its depth.
 * @param open - The open node ids.
 * @param rows - The rows, filled in.
 * @example
 * ```ts
 * appendRows(scene, "ui:boardScreen", 0, open, rows);
 * ```
 */
function appendRows(
  scene: SceneSnapshot,
  id: string,
  depth: number,
  open: ReadonlySet<string>,
  rows: TreeRow[]
): void {
  const node = scene.nodes.get(id);
  if (node === undefined) return;

  const isOpen = open.has(id);
  rows.push({
    id,
    depth,
    name: node.name,
    type: node.type,
    open: isOpen,
    hasChildren: node.children.length > 0,
    texture: node.texture,
    entity: node.entity?.id,
    key: node.key
  });
  if (!isOpen) return;
  for (const child of node.children) appendRows(scene, child, depth + 1, open, rows);
}

/**
 * The visible tree rows: depth first over the roots, only through open nodes.
 *
 * @param scene - The scene, if any.
 * @param open - The open node ids.
 * @returns The rows.
 * @example
 * ```ts
 * treeRowsOf(scene, new Set()).map(row => row.id); // ["ui:boardScreen", "entity:1048639"]
 * ```
 */
export function treeRowsOf(scene: SceneSnapshot | undefined, open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  if (scene === undefined) return rows;
  for (const root of scene.roots) appendRows(scene, root, 0, open, rows);
  return rows;
}

/**
 * The counts of the render tree card head, over every scene node.
 *
 * @param scene - The scene, if any.
 * @returns Nodes, nodes with a texture, entity nodes.
 * @example
 * ```ts
 * treeCounts(scene); // { nodes: 101, textures: 24, entities: 32 } on the merge-game board
 * ```
 */
export function treeCounts(scene: SceneSnapshot | undefined): {
  nodes: number;
  textures: number;
  entities: number;
} {
  let textures = 0;
  let entities = 0;
  for (const node of scene?.nodes.values() ?? []) {
    if (node.texture !== undefined) textures += 1;
    if (node.entity !== undefined) entities += 1;
  }
  return { nodes: scene?.nodes.size ?? 0, textures, entities };
}

/**
 * The first scene node, in paint order, that draws a texture.
 *
 * @param scene - The scene, if any.
 * @param key - The texture key.
 * @returns The node, or undefined when none draws it.
 * @example
 * ```ts
 * firstNodeWithTexture(scene, "board.cell")?.id; // "entity:3145728"
 * ```
 */
export function firstNodeWithTexture(
  scene: SceneSnapshot | undefined,
  key: string
): SceneNode | undefined {
  if (scene === undefined) return undefined;
  for (const id of scene.paintOrder) {
    const node = scene.nodes.get(id);
    if (node?.texture === key) return node;
  }
  return undefined;
}

/**
 * The draw calls tile: the counter when game.render reports one, else absent (WebGPU).
 *
 * @param render - The last game.render value, if any.
 * @returns The tile data, undefined before game.render.
 * @example
 * ```ts
 * drawCallsOf({ fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24 }); // { kind: "absent" }
 * ```
 */
function drawCallsOf(render: RenderStats | undefined): MetricTiles["drawCalls"] {
  if (render === undefined) return undefined;
  if (render.drawCalls === undefined) return { kind: "absent" };
  return { kind: "value", value: render.drawCalls };
}

/**
 * The six metric tiles from game.render, game.assets, the scene and the texture rows.
 *
 * @param state - renderView state.
 * @param rows - The loaded texture rows (for the unused count).
 * @returns The tiles; a tile without its data is undefined, heap is always absent.
 * @example
 * ```ts
 * tilesOf(ctx.state, textureRowsOf(ctx.state)).drawCalls; // { kind: "absent" }
 * ```
 */
export function tilesOf(state: RenderViewState, rows: readonly TextureRow[]): MetricTiles {
  const { render, assets, scene } = state;
  const unused = rows.filter(row => row.use.kind !== "in-use");
  const samples = [...state.fps];

  return {
    fps:
      render === undefined
        ? undefined
        : { now: render.fps, samples, low: samples.length > 0 ? Math.min(...samples) : render.fps },
    frameMs: render?.frameMs,
    drawCalls: drawCallsOf(render),
    textures:
      render === undefined || assets === undefined
        ? undefined
        : {
            gpuMb: render.textureMb,
            count: render.textures,
            bundles: assets.bundles.length,
            budgetMb: assets.budgetMb,
            unused: unused.length,
            unusedMb: round2(unused.reduce((total, row) => total + row.gpuMb, 0))
          },
    scene:
      render === undefined || scene === undefined
        ? undefined
        : { entities: scene.entityCount, views: render.views, pooled: render.pooled },
    heap: { kind: "absent" }
  };
}

/**
 * The derived view data, in copies.
 *
 * @param state - renderView state.
 * @returns The snapshot.
 * @example
 * ```ts
 * deriveSnapshot(ctx.state).tiles.heap; // { kind: "absent" }
 * ```
 */
export function deriveSnapshot(state: RenderViewState): RenderSnapshot {
  const { render } = state;
  return {
    frame: state.lastFrame,
    tiles: tilesOf(state, textureRowsOf(state)),
    tree: treeRowsOf(state.scene, state.tree.open),
    textures: visibleTextureRows(state),
    bundles: bundleRowsOf(state),
    pools: render === undefined ? undefined : { views: render.views, pooled: render.pooled },
    releases: [...state.releases]
  };
}
