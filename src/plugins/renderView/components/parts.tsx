/**
 * @file renderView components — the small parts every Mission control component draws the derive
 * layer's words with (spec 09 § M15 G "recurring components"): a tag in its tone, a line whose strong
 * parts are bold, the spinner, and a text with one bold part.
 */
import type { JSX } from "preact";
import type { Line, Tag as TagWords, Tone } from "../derive/words";

/** The `data-tag` value of each tone (workspace primitives: ok, warn, err, acc, mut; "" plain). */
const TAG_TONES: Readonly<Record<Tone, string>> = {
  plain: "",
  ok: "ok",
  warn: "warn",
  error: "err",
  acc: "acc",
  muted: "mut"
};

/**
 * Props of `Tag`.
 */
export type TagProps = { readonly tag: TagWords };

/**
 * A tag: its words in its tone, its title as the hover text.
 *
 * @param props - The tag.
 * @returns The tag.
 */
export function Tag(props: TagProps): JSX.Element {
  const { tag } = props;
  return (
    <span data-tag={TAG_TONES[tag.tone]} title={tag.title}>
      {tag.text}
    </span>
  );
}

/**
 * Props of `LineText`.
 */
export type LineTextProps = {
  readonly line: Line;
  /** Paints the strong parts in the warn colour. */
  readonly warn?: boolean;
};

/**
 * A line of words whose strong parts are bold (`<b>`).
 *
 * @param props - The line.
 * @returns The fragment.
 */
export function LineText(props: LineTextProps): JSX.Element {
  return (
    <>
      {props.line.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <b key={index} data-warn={props.warn === true ? "" : undefined}>
            {part.strong}
          </b>
        )
      )}
    </>
  );
}

/**
 * The spinner (workspace primitive), decorative.
 *
 * @returns The spinner.
 */
export function Spinner(): JSX.Element {
  return <span data-spinner aria-hidden="true" />;
}

/**
 * Props of `BoldPart`.
 */
export type BoldPartProps = { readonly text: string; readonly bold: string };

/**
 * A text with one part of it bold (the first time it occurs); the text as it is when the part is
 * not in it.
 *
 * @param props - The text and its bold part.
 * @returns The fragment.
 */
export function BoldPart(props: BoldPartProps): JSX.Element {
  const { text, bold } = props;
  const at = bold === "" ? -1 : text.indexOf(bold);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{bold}</b>
      {text.slice(at + bold.length)}
    </>
  );
}

/**
 * Props of `CodeText`.
 */
export type CodeTextProps = { readonly text: string };

/**
 * A text whose `backticked` parts are code (`<code>`), as the honest Connect texts write commands.
 *
 * @param props - The text.
 * @returns The fragment.
 */
export function CodeText(props: CodeTextProps): JSX.Element {
  return (
    <>
      {props.text
        .split("`")
        .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

/**
 * A line's words as one string (a list key, a title).
 *
 * @param line - The line.
 * @returns Its words.
 * @example
 * ```ts
 * lineKey([{ strong: "40" }, " textures, 68 % of budget"]); // "40 textures, 68 % of budget"
 * ```
 */
export function lineKey(line: Line): string {
  return line.map(part => (typeof part === "string" ? part : part.strong)).join("");
}
