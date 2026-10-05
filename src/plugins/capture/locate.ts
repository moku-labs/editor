/**
 * @file capture plugin — where editor.capture crops: a `rect` given in page CSS px, or the rect
 * of a keyed element read from the rect source the manifest lists (`game.locate` on game 0.4,
 * `game.rect` on game 0.1). The rect wins over the key.
 */
import type { Json, SelectionRect } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import type { CaptureRegistry, CropRequest } from "./types";
import { RECT_SOURCE_IDS, SHOT_ID } from "./types";

/**
 * The four fields of a rect; any other field makes the value no rect.
 */
const RECT_FIELDS: ReadonlySet<string> = new Set(["x", "y", "w", "h"]);

/**
 * Builds the -32602 refusal of the `rect` or `key` of editor.capture.
 *
 * @param field - The refused field.
 * @param problem - What is wrong, without the prefix.
 * @param hint - What to do about it.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw refused("key", 'no element with key "hud"', "Pass the key of a placed ui node");
 * ```
 */
function refused(field: CropRequest["field"], problem: string, hint: string): Error {
  return wireError(errorCode.invalidInput, `[moku-editor] ${SHOT_ID}: ${problem}.\n  ${hint}.`, {
    reason: "invalid_input",
    retryable: false,
    id: SHOT_ID,
    field
  });
}

/**
 * Reads `{ x, y, w, h }` of finite numbers and nothing else from a wire value.
 *
 * @param value - The wire value.
 * @returns The rect, or undefined for any other shape.
 * @example
 * ```ts
 * rectOf({ x: 12, y: 40, w: 96, h: 24 }); // the same rect
 * rectOf(null); // undefined: no element
 * ```
 */
function rectOf(value: Json): SelectionRect | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (Object.keys(value).some(key => !RECT_FIELDS.has(key))) return undefined;

  const { x, y, w, h } = value;
  const isRect =
    typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number";

  return isRect ? { x, y, w, h } : undefined;
}

/**
 * Checks the `rect` input of editor.capture: `{ x, y, w, h }` in page CSS px, w and h above 0.
 *
 * @param value - The schema-checked `rect` (any JSON).
 * @returns The rect.
 * @throws {Error} -32602 `invalid_input` naming `rect`.
 * @example
 * ```ts
 * checkRect({ x: 12, y: 40, w: 96, h: 24 }); // { x: 12, y: 40, w: 96, h: 24 }
 * ```
 */
export function checkRect(value: Json): SelectionRect {
  const rect = rectOf(value);

  if (rect === undefined || rect.w <= 0 || rect.h <= 0) {
    throw refused(
      "rect",
      "rect must be { x, y, w, h } in page CSS px, w and h above 0",
      "Pass the rect of an element, for example the rect of moku_selection"
    );
  }

  return rect;
}

/**
 * The source an element's page rect is read from: `game.locate` when the registry has it (game
 * 0.4), else `game.rect` (game 0.1).
 *
 * @param registry - The registry slice.
 * @returns The source id, or undefined when the game reports no element rects.
 * @example
 * ```ts
 * rectSourceOf(registry); // "game.locate" on game 0.4
 * ```
 */
export function rectSourceOf(registry: Pick<CaptureRegistry, "source">): string | undefined {
  return RECT_SOURCE_IDS.find(id => registry.source(id) !== undefined);
}

/**
 * Reads the page rect of a keyed element from the rect source.
 *
 * @param registry - The registry slice.
 * @param key - The element key, e.g. `"hud/infoBar"`.
 * @returns The rect in page CSS px.
 * @throws {Error} -32602 `invalid_input` naming `key` when the game reports no element rects or
 *   has no element with that key. Errors of the source pass unchanged.
 * @example
 * ```ts
 * locateKey(registry, "hud/infoBar"); // { x: 12, y: 40, w: 96, h: 24 }
 * ```
 */
export function locateKey(registry: Pick<CaptureRegistry, "source">, key: string): SelectionRect {
  const id = rectSourceOf(registry);
  const source = id === undefined ? undefined : registry.source(id);

  if (source === undefined) {
    throw refused(
      "key",
      "this game reports no element rects (no game.locate, no game.rect)",
      "Pass rect instead, or update the game"
    );
  }

  const rect = rectOf(source.read({ key }));
  if (rect === undefined) {
    throw refused(
      "key",
      `no element with key ${JSON.stringify(key)}`,
      "Pass the key of a placed ui node; moku_selection shows it"
    );
  }

  return rect;
}

/**
 * The crop editor.capture asks: the `rect` when given, else the located rect of `key`, else none.
 *
 * @param input - The schema-checked input.
 * @param input.key - The key of an element to crop to.
 * @param input.rect - A rect in page CSS px to crop to; wins over `key`.
 * @param registry - The registry slice.
 * @returns The crop request, or undefined for the whole picture.
 * @throws {Error} -32602 `invalid_input` naming `rect` or `key`.
 * @example
 * ```ts
 * cropOf({ key: "hud/infoBar" }, registry); // { rect: { x: 12, y: 40, w: 96, h: 24 }, field: "key" }
 * ```
 */
export function cropOf(
  input: { readonly key?: string | undefined; readonly rect?: Json | undefined },
  registry: Pick<CaptureRegistry, "source">
): CropRequest | undefined {
  if (input.rect !== undefined) return { rect: checkRect(input.rect), field: "rect" };
  if (input.key !== undefined) return { rect: locateKey(registry, input.key), field: "key" };

  return undefined;
}
