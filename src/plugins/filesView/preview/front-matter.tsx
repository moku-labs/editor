/**
 * @file filesView plugin — the front matter of a Markdown note through the shared codec
 * `parseNote` (panels/shared/notes, R4) as property rows; captures open in Files; a front matter
 * the codec cannot read shows its raw lines. filesView has no front-matter parser of its own:
 * the raw lines are only cut at the `---` fences for display.
 */
import type { VNode } from "preact";
import { Fragment } from "preact";
import type { Note } from "../../panels/shared/notes";
import { isNoteParseError, parseNote } from "../../panels/shared/notes";
import type { NoteParts } from "../types";

/**
 * The fence line of a front matter.
 */
const FENCE = "---";

/**
 * An unknown front-matter key line kept by the codec (`owner: alex`).
 */
const EXTRA_KEY = /^([\w-]+):\s?(.*)$/;

/**
 * Props of `FrontMatterRows`.
 *
 * @example
 * ```ts
 * const props: FrontMatterRowsProps = { text: "---\ntitle: First\n---\n", onOpenPath: path => open(path) };
 * ```
 */
export type FrontMatterRowsProps = {
  readonly text: string;
  readonly onOpenPath: (path: string) => void;
};

/**
 * One property row.
 */
type Row = { readonly label: string; readonly value: string };

/**
 * Splits a Markdown file for the preview: no front matter, a note the shared codec read, or the
 * raw lines of a front matter it could not read (then the body after the closing fence).
 *
 * @param text - The file text.
 * @returns The parts.
 * @example
 * ```ts
 * noteParts("# Title\n"); // { kind: "none", body: "# Title\n" }
 * ```
 */
export function noteParts(text: string): NoteParts {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== FENCE) return { kind: "none", body: text };

  const note = parseNote(text);
  if (!isNoteParseError(note)) return { kind: "note", note, body: note.body };

  const close = lines.findIndex((line, index) => index > 0 && line === FENCE);
  if (close === -1) return { kind: "raw", lines: lines.slice(1), body: "" };
  return { kind: "raw", lines: lines.slice(1, close), body: lines.slice(close + 1).join("\n") };
}

/**
 * The rows of the unknown keys the codec kept: `key: value` lines, with indented lines joined to
 * the row above.
 *
 * @param extra - The codec's extra lines.
 * @returns The rows.
 * @example
 * ```ts
 * extraRows(["owner: alex"]); // [{ label: "owner", value: "alex" }]
 * ```
 */
function extraRows(extra: readonly string[]): Row[] {
  const rows: { label: string; value: string }[] = [];
  for (const line of extra) {
    const match = EXTRA_KEY.exec(line);
    const last = rows.at(-1);
    if (match) rows.push({ label: match[1] ?? "", value: match[2] ?? "" });
    else if (last === undefined) rows.push({ label: "", value: line.trim() });
    else last.value = `${last.value} ${line.trim()}`.trim();
  }
  return rows;
}

/**
 * The scalar rows of a note in the codec's key order: title, from, to, status, created.
 *
 * @param note - The parsed note.
 * @returns The rows.
 * @example
 * ```ts
 * scalarRows(note)[0]; // { label: "title", value: "First top item" }
 * ```
 */
function scalarRows(note: Note): Row[] {
  const rows: Row[] = [{ label: "title", value: note.title }];
  if (note.from !== undefined) {
    const { node, outcome } = note.from;
    rows.push({ label: "from", value: outcome === undefined ? node : `${node} · ${outcome}` });
  }
  if (note.to !== undefined) rows.push({ label: "to", value: note.to });
  rows.push({ label: "status", value: note.status });
  if (note.created !== undefined) rows.push({ label: "created", value: note.created });
  return rows;
}

/**
 * The note's front matter as property rows (`[data-props]`), captures as links that open in
 * Files; an unreadable front matter as one mono block; nothing without a front matter.
 *
 * @param props - The file text and the opener.
 * @returns The rows, the raw block, or nothing.
 */
export function FrontMatterRows(props: FrontMatterRowsProps): VNode | undefined {
  const parts = noteParts(props.text);
  if (parts.kind === "none") return undefined;
  if (parts.kind === "raw") {
    return <pre data-front-matter="raw">{parts.lines.join("\n")}</pre>;
  }

  const { note } = parts;
  return (
    <dl data-props data-front-matter="note">
      {scalarRows(note).map(row => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Fragment>
      ))}
      {note.captures.length > 0 && (
        <>
          <dt>captures</dt>
          <dd>
            {note.captures.map(path => (
              <button key={path} type="button" data-link onClick={() => props.onOpenPath(path)}>
                {path}
              </button>
            ))}
          </dd>
        </>
      )}
      {extraRows(note.extra).map(row => (
        <Fragment key={`extra:${row.label}:${row.value}`}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
