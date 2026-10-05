/**
 * @file capture plugin — the `format` and `quality` of editor.capture and editor.sheet (D-34):
 * JPEG at 0.8 by default, `"png"` keeps the old lossless path. Pure.
 */
import { errorCode, wireError } from "../registry/protocol";
import type { PictureFormat } from "./types";
import { DEFAULT_FORMAT, DEFAULT_QUALITY, SHOT_ID } from "./types";

/**
 * Builds the -32602 refusal of an encoding field.
 *
 * @param id - The command, named in the error.
 * @param field - The refused field.
 * @param rule - What the field must be, without the prefix.
 * @param hint - What to do about it.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw refusedField("editor.capture", "quality", "quality must be a number above 0 and at most 1", "0.8 is the default");
 * ```
 */
function refusedField(id: string, field: string, rule: string, hint: string): Error {
  return wireError(errorCode.invalidInput, `[moku-editor] ${id}: ${rule}.\n  ${hint}.`, {
    reason: "invalid_input",
    retryable: false,
    id,
    field
  });
}

/**
 * True for a format the page encodes.
 *
 * @param format - The input format.
 * @returns Whether it is `"jpeg"` or `"png"`.
 */
function isPictureFormat(format: string): format is PictureFormat {
  return format === "jpeg" || format === "png";
}

/**
 * Checks the optional `format` and `quality` of editor.capture or editor.sheet and fills the
 * defaults: JPEG at 0.8. `quality` is a number above 0 and at most 1; png ignores it.
 *
 * @param input - The schema-checked input.
 * @param input.format - `"jpeg"` or `"png"`, absent = `"jpeg"`.
 * @param input.quality - The JPEG quality, absent = 0.8.
 * @param id - The command, named in the errors.
 * @returns The format and the quality.
 * @throws {Error} -32602 `invalid_input` naming `format` or `quality`.
 * @example
 * ```ts
 * checkEncoding({}); // { format: "jpeg", quality: 0.8 }
 * checkEncoding({ format: "png" }, "editor.sheet"); // { format: "png", quality: 0.8 }
 * ```
 */
export function checkEncoding(
  input: { readonly format?: string | undefined; readonly quality?: number | undefined },
  id: string = SHOT_ID
): { readonly format: PictureFormat; readonly quality: number } {
  const { format = DEFAULT_FORMAT, quality = DEFAULT_QUALITY } = input;

  if (!isPictureFormat(format)) {
    throw refusedField(
      id,
      "format",
      'format must be "jpeg" or "png"',
      "JPEG is the default; ask png for a lossless picture"
    );
  }

  const isQualityInRange = Number.isFinite(quality) && quality > 0 && quality <= 1;
  if (!isQualityInRange) {
    throw refusedField(
      id,
      "quality",
      "quality must be a number above 0 and at most 1",
      `${String(DEFAULT_QUALITY)} is the default`
    );
  }

  return { format, quality };
}
