/**
 * @file Shared view module — style blocks of a TypeScript source file and the one safe
 * numeric-literal edit with a version-checked write (flowView Styles C4, gameView Element C7).
 * Bounds and error codes live only here (R8).
 */
import type { FileText, WriteResult } from "../../registry/protocol";

/**
 * Which block of a style file: a text-style table entry or a `defineStyle` constant (R8, R9).
 */
export type StyleBlockRef =
  | { readonly kind: "text"; readonly key: string }
  | { readonly kind: "const"; readonly name: string };

/**
 * A numeric literal field with its exact columns.
 */
export type NumberField = {
  readonly kind: "number";
  /** "size", "shadow.dy", "padding.left". */
  readonly path: string;
  readonly value: number;
  /** The literal as written: "60", "0.55". */
  readonly raw: string;
  /** 1-based. */
  readonly line: number;
  /** 0-based; [colStart, colEnd) is the literal on that line. */
  readonly colStart: number;
  readonly colEnd: number;
};

/**
 * Any other field (identifier, string, boolean, hex, expression): read-only.
 */
export type OtherField = {
  readonly kind: "other";
  readonly path: string;
  readonly raw: string;
  readonly line: number;
};

/**
 * One field of a style block.
 */
export type StyleField = NumberField | OtherField;

/**
 * One style block and its fields.
 */
export type StyleBlock = {
  readonly ref: StyleBlockRef;
  readonly line: number;
  readonly endLine: number;
  readonly fields: readonly StyleField[];
};

/**
 * A parsed style file.
 */
export type StyleFile = {
  readonly blocks: readonly StyleBlock[];
  /** Identifier → "#rrggbb", for read-only swatches. */
  readonly colours: ReadonlyMap<string, string>;
  readonly eol: "\n" | "\r\n";
};

/**
 * Why an edit was refused.
 */
export type StyleEditCode =
  | "no-file"
  | "parse"
  | "no-key"
  | "ambiguous"
  | "not-literal"
  | "read-only"
  | "changed-on-disk"
  | "out-of-range";

/**
 * A refused edit (returned, never thrown).
 */
export type StyleEditError = {
  readonly error: StyleEditCode;
  readonly line?: number;
  readonly key?: string;
  readonly path?: string;
};

/**
 * Stepper bounds of one field.
 */
export type FieldRule = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly bigStep: number;
  readonly integer: boolean;
};

/**
 * What the card showed: block, field path and the literal as written.
 */
export type EditTarget = {
  readonly ref: StyleBlockRef;
  readonly path: string;
  readonly raw: string;
};

/**
 * An edited text.
 */
export type EditDone = { readonly text: string; readonly line: number };

/**
 * A successful write.
 */
export type WriteDone = {
  readonly ok: true;
  readonly text: string;
  readonly line: number;
  readonly version: string;
  readonly bytes: number;
};

/**
 * Structural files client: link.files and tools.files fit it.
 */
export type StyleFiles = {
  read(path: string): Promise<FileText>;
  write(path: string, text: string, version?: string): Promise<WriteResult>;
};

/**
 * Parses the style blocks and colour constants of a file.
 *
 * @param _text - The file text.
 * @example
 * ```ts
 * const file = parseStyleFile(text);
 * ```
 */
export function parseStyleFile(_text: string): StyleFile | StyleEditError {
  throw new Error("not implemented");
}

/**
 * Finds one block by ref: `no-key` or `ambiguous` when not exactly one.
 *
 * @param _file - A parsed style file.
 * @param _ref - The block ref.
 * @example
 * ```ts
 * findBlock(file, { kind: "text", key: "ui.number" });
 * ```
 */
export function findBlock(_file: StyleFile, _ref: StyleBlockRef): StyleBlock | StyleEditError {
  throw new Error("not implemented");
}

/**
 * The stepper rule of a field, or undefined (the field is then read-only).
 *
 * @param _ref - The block ref.
 * @param _path - The field path.
 * @example
 * ```ts
 * fieldRule({ kind: "text", key: "ui.number" }, "size"); // { min: 1, max: 512, step: 1, bigStep: 10, integer: false }
 * ```
 */
export function fieldRule(_ref: StyleBlockRef, _path: string): FieldRule | undefined {
  throw new Error("not implemented");
}

/**
 * The next stepper value: rounded to 2 decimals, clamped, integer when the rule says so.
 *
 * @param _rule - The field rule.
 * @param _value - The current value.
 * @param _direction - 1 up, -1 down.
 * @param _big - Shift held.
 * @example
 * ```ts
 * stepValue(rule, 0.55, 1, false); // 0.6
 * ```
 */
export function stepValue(
  _rule: FieldRule,
  _value: number,
  _direction: 1 | -1,
  _big: boolean
): number {
  throw new Error("not implemented");
}

/**
 * Prints a number: integers without decimals, else at most 2 decimals, trailing zeros trimmed.
 *
 * @param _value - The number.
 * @example
 * ```ts
 * formatNumber(0.333); // "0.33"
 * ```
 */
export function formatNumber(_value: number): string {
  throw new Error("not implemented");
}

/**
 * Replaces exactly one numeric literal; every other byte stays.
 *
 * @param _text - The current file text.
 * @param _target - What the card showed.
 * @param _next - The new value.
 * @example
 * ```ts
 * editNumber(text, { ref: { kind: "text", key: "ui.number" }, path: "size", raw: "60" }, 64);
 * ```
 */
export function editNumber(
  _text: string,
  _target: EditTarget,
  _next: number
): EditDone | StyleEditError {
  throw new Error("not implemented");
}

/**
 * Reads and parses a style file; a missing or forbidden file → `no-file`.
 *
 * @param _files - The files client.
 * @param _path - The style file path.
 * @example
 * ```ts
 * const loaded = await loadStyleFile(tools.files, "features/ui/styles.ts");
 * ```
 */
export function loadStyleFile(
  _files: StyleFiles,
  _path: string
): Promise<
  { readonly text: string; readonly version: string; readonly file: StyleFile } | StyleEditError
> {
  throw new Error("not implemented");
}

/**
 * Edits and writes with the read version; one retry on -32005 when the literal is unchanged.
 *
 * @param _files - The files client.
 * @param _path - The style file path.
 * @param _current - The text and version the card was built from.
 * @param _target - What the card showed.
 * @param _next - The new value.
 * @example
 * ```ts
 * await writeNumber(tools.files, "features/ui/styles.ts", loaded, target, 64);
 * ```
 */
export function writeNumber(
  _files: StyleFiles,
  _path: string,
  _current: FileText,
  _target: EditTarget,
  _next: number
): Promise<WriteDone | StyleEditError> {
  throw new Error("not implemented");
}

/**
 * True for a StyleEditError.
 *
 * @param _value - Anything.
 * @example
 * ```ts
 * if (isStyleEditError(loaded)) return showReason(loaded);
 * ```
 */
export function isStyleEditError(_value: unknown): _value is StyleEditError {
  throw new Error("not implemented");
}
