/**
 * @file gameView plugin — what an index answer (a `StyleSource`) says about its style, pure: the
 * file the style is written in, every file the answer was read from (a change to one of them
 * makes it stale, D-46), and the style as it is written on the element. No ctx, no I/O: the pure
 * modules of reference/ import it too.
 */
import type { StyleSource } from "../types";

/**
 * The file the style of a source was read from: the component file of an id prop whose own tag
 * has no style, else the file of the key.
 *
 * @param source - Where the index found a ui key.
 * @returns The root-relative file the `style` attribute is written in.
 * @example
 * ```ts
 * // merge-game's giftReward: `amountKey="giftReward"` in daily-gift.tsx, the text in <Amount>.
 * stylePathOf({ kind: "defined", path: "features/gift/popups/daily-gift.tsx", line: 25, range: [23, 9, 29, 11], textStyle: "ui.amount", stylePath: "shared/views/amount.tsx" });
 * // "shared/views/amount.tsx"
 * ```
 */
export function stylePathOf(source: StyleSource): string {
  return source.stylePath ?? source.path;
}

/**
 * Every file a source was read from, each once: the file of the key, the component file its style
 * was read from, and the component files that were looked at and gave no style. A project change
 * to one of them makes the source stale.
 *
 * @param source - Where the index found a ui key.
 * @returns The root-relative files, the file of the key first.
 * @example
 * ```ts
 * // An id prop whose component draws its element without a style: the component may gain one.
 * sourcePaths({ kind: "defined", path: "src/hud/Hud.tsx", line: 2, range: [1, 1, 3, 3], stylelessPaths: ["src/kit/pill.tsx"] });
 * // ["src/hud/Hud.tsx", "src/kit/pill.tsx"]
 * ```
 */
export function sourcePaths(source: StyleSource): readonly string[] {
  const { path, stylePath, stylelessPaths = [] } = source;
  return stylePath === undefined ? [path, ...stylelessPaths] : [path, stylePath, ...stylelessPaths];
}

/**
 * The style of a source as it is written on the element: the identifier of `style={ident}`, or
 * the call of `style={call(…)}`. A text style key is not one: each view names it its own way.
 *
 * @param source - The index answer of a ui key, undefined when there is none.
 * @returns The identifier or the call, undefined for any other source.
 * @example
 * ```ts
 * writtenStyle({ kind: "call", path: "features/orders/strip.tsx", line: 216, range: [215, 5, 247, 14], call: "orderCardStyle(card.slot)", callLine: 218 });
 * // "orderCardStyle(card.slot)"
 * ```
 */
export function writtenStyle(source: StyleSource | undefined): string | undefined {
  if (source?.kind === "ident") return source.ref.name;
  return source?.kind === "call" ? source.call : undefined;
}
