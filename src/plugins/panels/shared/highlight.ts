/**
 * @file Shared view module — the one syntax highlighter of the tools page: hand-written TS/TSX,
 * CSS, JSON and Markdown scanners emitting `<span data-token="<kind>">` VNodes (no innerHTML, no
 * class). Colours come from the workspace `[data-token]` atoms and `--code-*` tokens.
 */
import type { ComponentChildren } from "preact";

/**
 * A highlighter language.
 */
export type Lang = "script" | "css" | "json" | "markdown" | "plain";

/**
 * A token kind (one `--code-<kind>` token each).
 */
export type TokenKind =
  | "plain"
  | "keyword"
  | "literal"
  | "string"
  | "number"
  | "comment"
  | "type"
  | "function"
  | "property"
  | "tag"
  | "attr"
  | "punct"
  | "operator"
  | "meta"
  | "heading";

/**
 * One token of a line.
 */
export type Token = { readonly text: string; readonly kind: TokenKind };

/**
 * The language of a path by its extension.
 *
 * @param _path - A file path.
 * @example
 * ```ts
 * langOf("nodes/merge.ts"); // "script"
 * ```
 */
export function langOf(_path: string): Lang {
  throw new Error("not implemented");
}

/**
 * Tokenizes text into one token array per line; never throws; token texts concatenate to the line.
 *
 * @param _text - The file text.
 * @param _lang - The language.
 * @example
 * ```ts
 * const lines = tokenizeLines(text, langOf(path));
 * ```
 */
export function tokenizeLines(_text: string, _lang: Lang): Token[][] {
  throw new Error("not implemented");
}

/**
 * Renders one line: plain → text, others → `h("span", { "data-token": kind }, text)`.
 *
 * @param _line - The tokens of one line.
 * @example
 * ```ts
 * lines.map((line, index) => h("div", { "data-line": index + 1 }, renderTokens(line)));
 * ```
 */
export function renderTokens(_line: readonly Token[]): ComponentChildren {
  throw new Error("not implemented");
}
