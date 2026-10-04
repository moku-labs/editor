/**
 * @file gameView plugin — the facts of the reference block (round 2 R2), gathered for one scene
 * node: its ui ancestors from the scene, its source and style block (the source search and the
 * style module, shared with the Element tab), its flags and text from the raw `game.ui` node, one
 * read each of `game.position`, `game.history { last: 1 }` and (without a pick) `game.tainted`,
 * the link's manifest, session and status, workspace's device and the last pick of the node. A
 * read that fails leaves its fact out; nothing here throws.
 */
import { linkPlugin } from "../../link";
import type { SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { ancestorsOf } from "../../panels/shared/scene";
import type { Json } from "../../registry/protocol";
import { resolveDevice } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { positionOf } from "../capture/naming";
import { isObject } from "../capture/shot";
import { findStyleSource } from "../element/source";
import { blockOf } from "../element/styles";
import type { BlockAt, GameViewCtx, StyleSource } from "../types";
import {
  type DeviceFacts,
  type LastEdge,
  type PickFacts,
  type ReferenceFacts,
  referenceBlock
} from "./block";

/**
 * A JSON object of the wire.
 */
type JsonObject = { [key: string]: Json };

/**
 * The flags the state line names when true, in order.
 */
const FLAGS = ["pressed", "disabled", "selected"] as const;

/**
 * Reads a source once; undefined when it cannot be read.
 *
 * @param ctx - Domain context of gameView.
 * @param id - The source id.
 * @param input - Its input.
 * @returns The value, or undefined.
 */
async function readOnce(ctx: GameViewCtx, id: string, input?: Json): Promise<Json | undefined> {
  try {
    return await ctx.require(linkPlugin).read(id, input);
  } catch {
    return undefined;
  }
}

/**
 * The newest edge of a `game.history` value (oldest first).
 *
 * @param value - The game.history value.
 * @returns Where it left, the outcome and the frame when reported; undefined for none.
 * @example
 * ```ts
 * lastEdgeOf([{ path: "home", outcome: "play", frame: 96 }]); // { path: "home", outcome: "play", frame: 96 }
 * ```
 */
export function lastEdgeOf(value: Json | undefined): LastEdge | undefined {
  const entry = Array.isArray(value) ? value.at(-1) : undefined;
  if (!isObject(entry) || typeof entry.path !== "string" || typeof entry.outcome !== "string") {
    return undefined;
  }
  const { path, outcome, frame } = entry;
  return typeof frame === "number" ? { path, outcome, frame } : { path, outcome };
}

/**
 * True for the game's synthetic root: several mounted roots come under an unkeyed `screen` with a
 * zero rect (the scene's own reader does the same).
 *
 * @param node - The top node of game.ui.
 * @returns Whether it adds no path segment.
 */
function isSyntheticRoot(node: JsonObject): boolean {
  const { rect } = node;
  const zero = isObject(rect) && rect.x === 0 && rect.y === 0 && rect.w === 0 && rect.h === 0;
  return node.key === undefined && node.type === "screen" && zero;
}

/**
 * The children of a raw ui node that are objects.
 *
 * @param node - A raw ui node.
 * @returns Its children.
 */
function childrenOf(node: JsonObject): readonly JsonObject[] {
  return Array.isArray(node.children) ? node.children.filter(child => isObject(child)) : [];
}

/**
 * The path segment of a raw ui node: its key, else `type#index` (the scene's rule).
 *
 * @param node - A raw ui node.
 * @param index - Its index among its siblings.
 * @returns The segment.
 */
function segmentOf(node: JsonObject, index: number): string {
  return typeof node.key === "string" ? node.key : `${String(node.type)}#${index}`;
}

/**
 * The raw `game.ui` node at a ui path: the scene keeps no `state` or text of a node, the value
 * the game sent does.
 *
 * @param ui - The game.ui value.
 * @param path - The ui path ("settingsScreen/settingsBoard").
 * @returns The raw node, undefined when the path is not in the value.
 * @example
 * ```ts
 * rawUiNodeAt(ui, "settingsScreen/settingsBoard")?.state; // { pressed: false, selected: false, … }
 * ```
 */
export function rawUiNodeAt(ui: Json | undefined, path: string): JsonObject | undefined {
  if (!isObject(ui)) return undefined;
  let level: readonly JsonObject[] = isSyntheticRoot(ui) ? childrenOf(ui) : [ui];
  let found: JsonObject | undefined;
  for (const segment of path.split("/")) {
    found = level.find((node, index) => segmentOf(node, index) === segment);
    if (found === undefined) return undefined;
    level = childrenOf(found);
  }
  return found;
}

/**
 * The true flags of a node: from its style, or from the `state` of its raw ui node.
 *
 * @param node - The scene node.
 * @param raw - Its raw ui node.
 * @returns The flags, in the order pressed, disabled, selected.
 */
function flagsOf(node: SceneNode, raw: JsonObject | undefined): readonly string[] {
  const state = isObject(raw?.state) ? raw.state : undefined;
  return FLAGS.filter(flag => node.style?.[flag] === true || state?.[flag] === true);
}

/**
 * The text a node shows, when the game reports it (`content` of the raw node or of the style).
 *
 * @param node - The scene node.
 * @param raw - Its raw ui node.
 * @returns The text, or undefined.
 */
function contentOf(node: SceneNode, raw: JsonObject | undefined): string | undefined {
  const content = raw?.content ?? node.style?.content;
  return typeof content === "string" ? content : undefined;
}

/**
 * The source of a ui key: remembered, else the search (the one in flight when there is one).
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key, undefined for an entity or an unkeyed node.
 * @returns The source, undefined when none is found or the search failed.
 */
async function sourceFor(
  ctx: GameViewCtx,
  key: string | undefined
): Promise<StyleSource | undefined> {
  if (key === undefined) return undefined;
  try {
    return ctx.state.found.get(key) ?? (await findStyleSource(ctx, key));
  } catch {
    return undefined;
  }
}

/**
 * Where the style block of an identifier source is.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @param source - Its source.
 * @returns The block place, undefined for another source or when it cannot be loaded.
 */
async function blockFor(
  ctx: GameViewCtx,
  key: string | undefined,
  source: StyleSource | undefined
): Promise<BlockAt | undefined> {
  if (key === undefined || source?.kind !== "ident") return undefined;
  try {
    return await blockOf(ctx, key, source);
  } catch {
    return undefined;
  }
}

/**
 * The device as it shows now.
 *
 * @param ctx - Domain context of gameView.
 * @returns The device facts.
 */
function deviceFacts(ctx: GameViewCtx): DeviceFacts {
  const { preset, orientation } = ctx.require(workspacePlugin).device();
  const { w, h, safe } = resolveDevice(preset, orientation);
  return { name: preset.name, w, h, orientation, dpr: preset.dpr, safe };
}

/**
 * The ui ancestors of a node, nearest first.
 *
 * @param scene - The scene.
 * @param node - The node.
 * @returns The ancestors that are ui nodes.
 */
function parentsOf(scene: SceneSnapshot, node: SceneNode): readonly SceneNode[] {
  return ancestorsOf(scene, node.id)
    .toReversed()
    .flatMap(id => scene.nodes.get(id) ?? [])
    .filter(parent => parent.ref.kind === "ui");
}

/**
 * The facts of one scene node for its reference block.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @param scene - The scene it is in.
 * @returns The facts.
 */
export async function referenceFacts(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot
): Promise<ReferenceFacts> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const pick = state.pick?.nodeId === node.id ? state.pick : undefined;

  // The reads and the source search, side by side.
  const [position, history, tainted, source] = await Promise.all([
    readOnce(ctx, "game.position"),
    readOnce(ctx, "game.history", { last: 1 }),
    pick?.tainted === undefined ? readOnce(ctx, "game.tainted") : pick.tainted,
    sourceFor(ctx, node.key)
  ]);
  const raw = node.ref.kind === "ui" ? rawUiNodeAt(state.sources.ui, node.ref.path) : undefined;
  const picked: PickFacts | undefined =
    pick === undefined ? undefined : { bookmark: pick.bookmark, crop: pick.crop, full: pick.full };

  return {
    node,
    parents: parentsOf(scene, node),
    position: position === undefined ? {} : positionOf(position),
    last: lastEdgeOf(history),
    source,
    block: await blockFor(ctx, node.key, source),
    flags: flagsOf(node, raw),
    value: contentOf(node, raw),
    frame: pick?.frame ?? scene.frame,
    game: {
      name: link.manifest()?.game,
      session: link.session(),
      at: new Date(),
      status: link.status().kind,
      tainted: typeof tainted === "boolean" ? tainted : undefined
    },
    device: deviceFacts(ctx),
    pick: picked
  };
}

/**
 * The reference block of one scene node.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @param scene - The scene it is in.
 * @returns The block text.
 */
export async function referenceText(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot
): Promise<string> {
  return referenceBlock(await referenceFacts(ctx, node, scene));
}
