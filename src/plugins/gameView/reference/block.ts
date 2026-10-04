/**
 * @file gameView plugin — the reference block (round 2 R2), pure: what a pick or "Copy reference"
 * puts on the clipboard for the chat. One fact per line in a fixed order (`@moku` head, `path`,
 * `source`, `layout`, `bounds`, `state`, `flow`, `game`, `device`, `restore`, `shot`); a line or a
 * field that is not known is left out. The facts are gathered elsewhere (reference/facts).
 */
import type { PageRect, SceneNode } from "../../panels/shared/scene";
import type { Json, Orientation } from "../../registry/protocol";
import type { PositionInfo } from "../capture/naming";
import type { BlockAt, StyleSource } from "../types";

/**
 * The newest edge of game.history: where it left, the outcome and its frame (when the game
 * reports one).
 */
export type LastEdge = { readonly path: string; readonly outcome: string; readonly frame?: number };

/**
 * The game line's facts; each one may be unknown.
 */
export type GameFacts = {
  /** The manifest's game: name and version. */
  readonly name: string | undefined;
  readonly session: string | undefined;
  /** When the facts were gathered (printed HH:MM:SS, local time). */
  readonly at: Date | undefined;
  /** The link status kind: "live", "paused" … */
  readonly status: string | undefined;
  readonly tainted: boolean | undefined;
};

/**
 * The device line's facts: the preset as it shows now, resolved for the orientation.
 */
export type DeviceFacts = {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly orientation: Orientation;
  readonly dpr: number;
  readonly safe: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
};

/**
 * What a pick of the element added: the bookmark id, the crop and the full frame.
 */
export type PickFacts = {
  readonly bookmark: string | undefined;
  readonly crop: string | undefined;
  readonly full: string | undefined;
};

/**
 * Everything the block prints, gathered for one scene node.
 */
export type ReferenceFacts = {
  readonly node: SceneNode;
  /** The ui ancestors, nearest first (`layout` prints three at most). */
  readonly parents: readonly SceneNode[];
  readonly position: PositionInfo;
  readonly last: LastEdge | undefined;
  readonly source: StyleSource | undefined;
  /** Where the style block of an identifier is. */
  readonly block: BlockAt | undefined;
  /** The true flags of `pressed`, `disabled`, `selected`, in that order. */
  readonly flags: readonly string[];
  /** The text the element shows, when the game reports it. */
  readonly value: string | undefined;
  readonly frame: number;
  readonly game: GameFacts;
  readonly device: DeviceFacts | undefined;
  readonly pick: PickFacts | undefined;
};

/** The parents `layout` names, nearest first. */
const LAYOUT_PARENTS = 3;

/** The components `path` names of an entity. */
const ENTITY_COMPONENTS = 5;

/**
 * Joins the known fields of one line with " · ".
 *
 * @param fields - The fields, undefined for unknown ones.
 * @returns The line, undefined when no field is known.
 * @example
 * ```ts
 * line(["a", undefined, "b"]); // "a · b"
 * ```
 */
function line(fields: readonly (string | undefined)[]): string | undefined {
  const known = fields.filter(field => field !== undefined);
  return known.length === 0 ? undefined : known.join(" · ");
}

/**
 * A field with its label, when its value is known.
 *
 * @param label - "style", "texture" …
 * @param value - The value.
 * @returns "label: value", or undefined.
 * @example
 * ```ts
 * labelled("texture", "ui.button-wood"); // "texture: ui.button-wood"
 * ```
 */
function labelled(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label}: ${value}`;
}

/**
 * A rect rounded as `x,y w×h`; the block and the one reference line print rects this way.
 *
 * @param rect - A rect.
 * @returns The text.
 * @example
 * ```ts
 * rectText({ x: 235.4, y: 74, w: 290.4, h: 75.6 }); // "235,74 290×76"
 * ```
 */
export function rectText(rect: PageRect): string {
  const [x, y, w, h] = [rect.x, rect.y, rect.w, rect.h].map(value => Math.round(value));
  return `${x},${y} ${w}×${h}`;
}

/**
 * Where the game is, as the head of the block and the one reference line name it: `flow/node`
 * when both are known, else the position path.
 *
 * @param position - The game.position info.
 * @returns The place, undefined when the position is not known.
 * @example
 * ```ts
 * flowNodeOf({ path: "board/settingsPopup/open", flow: "settingsPopup", node: "open" }); // "settingsPopup/open"
 * flowNodeOf({ path: "board/awaitIntent", flow: "board" }); // "board/awaitIntent"
 * ```
 */
export function flowNodeOf(position: PositionInfo): string | undefined {
  const { flow, node } = position;
  return flow !== undefined && node !== undefined ? `${flow}/${node}` : position.path;
}

/**
 * The text of a source: `file:line`, and ` (loop)` for a key built in a loop.
 *
 * @param source - A source search result.
 * @returns The text.
 * @example
 * ```ts
 * sourceText({ kind: "defined", path: "features/orders/strip.tsx", line: 157, loop: true }); // "features/orders/strip.tsx:157 (loop)"
 * ```
 */
export function sourceText(source: StyleSource): string {
  const at = `${source.path}:${source.line}`;
  return source.kind === "defined" && source.loop === true ? `${at} (loop)` : at;
}

/**
 * The style field: the identifier with the place of its block, or the call with its line.
 *
 * @param source - The source search result.
 * @param block - Where the identifier's block is.
 * @returns "style: …", or undefined without a style.
 */
function styleField(
  source: StyleSource | undefined,
  block: BlockAt | undefined
): string | undefined {
  if (source?.kind === "call") return `style: ${source.call} ${source.path}:${source.callLine}`;
  if (source?.kind !== "ident") return undefined;
  const at = block === undefined ? "" : ` ${block.path}:${block.line}`;
  return `style: ${source.ref.name}${at}`;
}

/**
 * A layout value: a number or a word as it is, four sides as `t/r/b/l` (an absent side is 0).
 *
 * @param value - A style value.
 * @returns The text, undefined for anything else.
 * @example
 * ```ts
 * layoutValue({ top: 266, right: 72, bottom: 64, left: 72 }); // "266/72/64/72"
 * ```
 */
function layoutValue(value: Json | undefined): string | undefined {
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const side = (key: string): number => {
    const found = value[key];
    return typeof found === "number" ? found : 0;
  };
  return `${side("top")}/${side("right")}/${side("bottom")}/${side("left")}`;
}

/**
 * One parent of the layout line: its name and its direction, padding, margin and gap.
 *
 * @param parent - A ui ancestor.
 * @returns "settingsBoard (column, padding 266/72/64/72, gap 24)", or the bare name.
 */
function layoutOf(parent: SceneNode): string {
  const style = parent.style ?? {};
  const fields = [
    layoutValue(style.direction),
    labelledValue("padding", style.padding),
    labelledValue("margin", style.margin),
    labelledValue("gap", style.gap)
  ].filter(field => field !== undefined);
  return fields.length === 0 ? parent.name : `${parent.name} (${fields.join(", ")})`;
}

/**
 * A layout field with its name: "padding 48".
 *
 * @param name - The field name.
 * @param value - Its style value.
 * @returns The field, undefined when the value is absent or not a layout value.
 */
function labelledValue(name: string, value: Json | undefined): string | undefined {
  const text = layoutValue(value);
  return text === undefined ? undefined : `${name} ${text}`;
}

/**
 * The head: name, type, flow/node of the game position and the frame.
 *
 * @param facts - The facts.
 * @returns "@moku settingsBoard · panel · settingsPopup/open · f1841".
 */
function headLine(facts: ReferenceFacts): string {
  const { node, position } = facts;
  return line([`@moku ${node.name}`, node.type, flowNodeOf(position), `f${facts.frame}`]) ?? "";
}

/**
 * The path line: the ui path, or the entity id with its first components.
 *
 * @param node - The node.
 * @returns "path: …".
 */
function pathLine(node: SceneNode): string {
  if (node.ref.kind === "ui") return `path: ${node.ref.path}`;
  const components = node.entity?.components.slice(0, ENTITY_COMPONENTS) ?? [];
  const list = components.length === 0 ? "" : ` (${components.join(", ")})`;
  return `path: entity #${node.ref.id}${list}`;
}

/**
 * The bounds line: device px, then the reference units.
 *
 * @param node - The node.
 * @returns "bounds: …", undefined for an unplaced node.
 */
function boundsLine(node: SceneNode): string | undefined {
  if (node.rect === undefined) return undefined;
  const ref = node.refRect === undefined ? undefined : `ref ${rectText(node.refRect)}`;
  return line([`bounds: ${rectText(node.rect)} px`, ref]);
}

/**
 * The state line: visible or hidden with the true flags, the value and the style's alpha.
 *
 * @param facts - The facts.
 * @returns "state: …".
 */
function stateLine(facts: ReferenceFacts): string {
  const { node, flags, value } = facts;
  const shown = [node.visible ? "visible" : "hidden", ...flags].join(", ");
  const alpha = node.style?.alpha;
  return (
    line([
      `state: ${shown}`,
      value === undefined ? undefined : `value "${value}"`,
      typeof alpha === "number" ? `alpha ${alpha}` : undefined
    ]) ?? ""
  );
}

/**
 * The flow line: the position path as a stack, and the last edge.
 *
 * @param facts - The facts.
 * @returns "flow: … · last: …", undefined when neither is known.
 */
function flowLine(facts: ReferenceFacts): string | undefined {
  const { position, last } = facts;
  const stack = position.path?.split("/").join(" > ");
  const frame = last?.frame === undefined ? "" : ` (f${last.frame})`;
  const edge = last === undefined ? undefined : `${last.path} → ${last.outcome}${frame}`;
  return line([labelled("flow", stack), labelled("last", edge)]);
}

/**
 * HH:MM:SS of a moment, local time.
 *
 * @param at - The moment.
 * @returns "09:05:07".
 * @example
 * ```ts
 * clockText(new Date(2026, 9, 4, 9, 5, 7)); // "09:05:07"
 * ```
 */
function clockText(at: Date): string {
  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map(part => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * The game line: name and version, session, frame, time, paused or live, tainted or clean. The
 * frame alone makes no line: it is in the head already.
 *
 * @param facts - The facts.
 * @returns "game: …", undefined when nothing but the frame is known.
 */
function gameLine(facts: ReferenceFacts): string | undefined {
  const { game } = facts;
  const tainted = taintText(game.tainted);
  const clock = game.at === undefined ? undefined : clockText(game.at);
  if (line([game.name, game.session, clock, game.status, tainted]) === undefined) return undefined;

  const frame = `f${facts.frame}`;
  return labelled("game", line([game.name, game.session, frame, clock, game.status, tainted]));
}

/**
 * The word of the tainted flag.
 *
 * @param tainted - The flag, undefined when not known.
 * @returns "tainted", "clean" or undefined.
 * @example
 * ```ts
 * taintText(false); // "clean"
 * ```
 */
function taintText(tainted: boolean | undefined): string | undefined {
  if (tainted === undefined) return undefined;
  return tainted ? "tainted" : "clean";
}

/**
 * The device line: preset, size and orientation, dpr and the safe insets.
 *
 * @param device - The device facts.
 * @returns "device: …", undefined without a device.
 */
function deviceLine(device: DeviceFacts | undefined): string | undefined {
  if (device === undefined) return undefined;
  const { safe } = device;
  return line([
    `device: ${device.name} ${device.w}×${device.h} ${device.orientation}`,
    `dpr ${device.dpr}`,
    `safe ${safe.top}/${safe.right}/${safe.bottom}/${safe.left}`
  ]);
}

/**
 * The block of one element for the chat. The first line is the head, for example
 * `@moku settingsBoard · panel · settingsPopup/open · f1841`.
 *
 * @param facts - What is known of the element, the game and the device.
 * @returns The block, one fact per line.
 */
export function referenceBlock(facts: ReferenceFacts): string {
  const { node, source, pick } = facts;
  const layout = facts.parents.slice(0, LAYOUT_PARENTS).map(parent => layoutOf(parent));
  const lines = [
    headLine(facts),
    pathLine(node),
    line([
      source === undefined ? undefined : `source: ${sourceText(source)}`,
      styleField(source, facts.block),
      labelled("texture", node.texture)
    ]),
    layout.length === 0 ? undefined : `layout: ${layout.join(" < ")}`,
    boundsLine(node),
    stateLine(facts),
    flowLine(facts),
    gameLine(facts),
    deviceLine(facts.device),
    labelled("restore", pick?.bookmark === undefined ? undefined : `bookmark ${pick.bookmark}`),
    line([labelled("shot", pick?.crop), labelled("frame", pick?.full)])
  ];
  return lines.filter(entry => entry !== undefined).join("\n");
}
