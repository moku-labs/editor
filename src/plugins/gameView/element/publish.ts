/**
 * @file gameView plugin — the editor page publishes its selection (U4, D-33): every change of
 * `state.selected` sends its SelectionInfo through `link.notify("selection", …)`, null when
 * nothing is selected. A source the search still looks for follows in a second publish. A pick
 * and an area publish their own info (card, crop, line). The last published info stays in
 * `state.selection`; a late follow-up of an older one is dropped.
 */
import { linkPlugin } from "../../link";
import type { SceneNode } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { SelectionInfo } from "../../registry/protocol";
import { messageOf } from "../report";
import type { GameViewCtx, StyleSource } from "../types";
import {
  bareSelection,
  type SelectionContext,
  type SelectionFacts,
  selectionOf,
  sourceAt
} from "./selection";
import { findStyleSource } from "./source";

/**
 * Sends a selection to the hub and keeps it as the last one published; without one it publishes
 * null (nothing selected). A publish that fails is a warning: the selection itself stands.
 *
 * @param ctx - Domain context of gameView.
 * @param info - The selection; omitted when nothing is selected.
 */
export function publishSelection(ctx: GameViewCtx, info?: SelectionInfo): void {
  ctx.state.selection = info;
  try {
    // eslint-disable-next-line unicorn/no-null -- null is the wire's "nothing selected"
    ctx.require(linkPlugin).notify("selection", info ?? null);
  } catch (error) {
    ctx.log.warn("gameView: selection publish failed", { message: messageOf(error) });
  }
}

/**
 * The session, the frame of a scene and the moment, for a selection published now.
 *
 * @param ctx - Domain context of gameView.
 * @param frame - The frame the selection shows, undefined without a scene.
 * @returns The context.
 */
export function selectionContext(ctx: GameViewCtx, frame: number | undefined): SelectionContext {
  return { session: ctx.require(linkPlugin).session(), frame, at: Date.now() };
}

/**
 * The facts of a node's selection: the context, the projections read last and a source.
 *
 * @param ctx - Domain context of gameView.
 * @param frame - The frame the selection shows.
 * @param source - The node's source search result, undefined when not known.
 * @returns The facts.
 */
export function selectionFacts(
  ctx: GameViewCtx,
  frame: number | undefined,
  source: StyleSource | undefined
): SelectionFacts {
  return { ...selectionContext(ctx, frame), projections: ctx.state.sources.projections, source };
}

/**
 * The source search result already known for a node's key.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @returns The remembered source, undefined for an entity, an unkeyed node or a key not found yet.
 */
export function knownSource(ctx: GameViewCtx, node: SceneNode): StyleSource | undefined {
  return node.key === undefined ? undefined : ctx.state.found.get(node.key);
}

/**
 * True while a published selection is still the last one: a newer publish replaced it otherwise.
 *
 * @param ctx - Domain context of gameView.
 * @param info - A published selection.
 * @returns Whether it is current.
 */
export function isCurrent(ctx: GameViewCtx, info: SelectionInfo): boolean {
  return ctx.state.selection === info;
}

/**
 * Publishes the selection again with the source of its key once the search finds it, unless
 * another publish came first. A failed search is logged at debug.
 *
 * @param ctx - Domain context of gameView.
 * @param published - The selection published without a source.
 * @param key - The ui key searched for.
 */
function followSource(ctx: GameViewCtx, published: SelectionInfo, key: string): void {
  findStyleSource(ctx, key).then(
    source => {
      if (source === undefined || !isCurrent(ctx, published)) return;
      publishSelection(ctx, { ...published, source: sourceAt(source), at: Date.now() });
    },
    (error: unknown) => {
      ctx.log.debug("gameView: selection source failed", { message: messageOf(error) });
    }
  );
}

/**
 * Publishes `state.selected`: null for none, its node's info from the scene there is (a ref the
 * scene does not have, bare), then its source when the search still runs.
 *
 * @param ctx - Domain context of gameView.
 */
export function publishSelected(ctx: GameViewCtx): void {
  const { selected, scene } = ctx.state;
  if (selected === undefined) {
    publishSelection(ctx);
    return;
  }

  const node = scene?.nodes.get(refId(selected));
  if (node === undefined) {
    publishSelection(ctx, bareSelection(selected, selectionContext(ctx, scene?.frame)));
    return;
  }

  const source = knownSource(ctx, node);
  const info = selectionOf(node, selectionFacts(ctx, scene?.frame, source));
  publishSelection(ctx, info);
  if (source === undefined && node.key !== undefined) followSource(ctx, info, node.key);
}

/**
 * True when a node is the selected element.
 *
 * @param ctx - Domain context of gameView.
 * @param node - A scene node.
 * @returns Whether `state.selected` names it.
 */
export function isSelected(ctx: GameViewCtx, node: SceneNode): boolean {
  const { selected } = ctx.state;
  return selected !== undefined && refId(selected) === node.id;
}

/**
 * The selection of a picked node: its info with the frame of the pick and the files it wrote.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @param picked - The frame, the card, the crop and the line of the pick.
 * @param picked.frame - The frame of the pick.
 * @param picked.card - The card file, undefined when none was written.
 * @param picked.crop - The crop, undefined when none was cut.
 * @param picked.line - The one reference line.
 * @returns The info.
 */
export function pickedSelection(
  ctx: GameViewCtx,
  node: SceneNode,
  picked: {
    readonly frame: number;
    readonly card: string | undefined;
    readonly crop: string | undefined;
    readonly line: string;
  }
): SelectionInfo {
  const info = selectionOf(node, selectionFacts(ctx, picked.frame, knownSource(ctx, node)));
  return {
    ...info,
    ...(picked.card === undefined ? {} : { card: picked.card }),
    ...(picked.crop === undefined ? {} : { crop: picked.crop }),
    line: picked.line
  };
}
