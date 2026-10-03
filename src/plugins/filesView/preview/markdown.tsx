/**
 * @file filesView plugin — a safe Markdown subset rendered as Preact VNodes only (never
 * innerHTML): ATX headings, fenced code through the shared highlighter, one level of nested
 * lists, quotes, rules, paragraphs; inline code, strong, em and links (http(s) in a new tab, a
 * relative path opens in Files, anything else stays text).
 */
import type { ComponentChildren, VNode } from "preact";
import { h } from "preact";
import { langOf, renderTokens, tokenizeLines } from "../../panels/shared/highlight";

/**
 * What a link target is: a web page, a project path, or neither (rendered as text).
 */
export type LinkTarget = "web" | "path" | "text";

/**
 * One item of a list, with at most one nested list.
 */
type ListItem = { readonly id: number; readonly text: string; readonly children: List | undefined };

/**
 * A list.
 */
type List = { readonly ordered: boolean; readonly items: ListItem[] };

/**
 * One block of the document.
 */
type Block = { readonly id: number } & (
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "code"; readonly lang: string; readonly lines: readonly string[] }
  | { readonly kind: "list"; readonly list: List }
  | { readonly kind: "quote"; readonly text: string }
  | { readonly kind: "rule" }
  | { readonly kind: "paragraph"; readonly text: string }
);

/**
 * One inline piece.
 */
type Inline = { readonly id: number } & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong" | "em"; readonly children: Inline[] }
  | { readonly kind: "link"; readonly text: string; readonly target: string }
);

/**
 * `# Heading` … `###### Heading`.
 */
const HEADING = /^(#{1,6})\s(.*)$/;

/**
 * A list line: indent, marker, text.
 */
const LIST_LINE = /^( *)([*-]|\d+\.) (.*)$/;

/**
 * A quote line.
 */
const QUOTE_LINE = /^> ?(.*)$/;

/**
 * A thematic break once spaces are removed.
 */
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/**
 * A URL scheme (`javascript:`, `mailto:` …).
 */
const SCHEME = /^[a-z][\d+.a-z-]*:/i;

/**
 * A web link.
 */
const WEB = /^https?:\/\//i;

/**
 * Fence languages the highlighter knows under another name.
 */
const FENCE_ALIASES: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "js",
  markdown: "md"
};

/**
 * Hands out ids for the keys of one render.
 */
type Ids = { next: number };

/**
 * The next id.
 *
 * @param ids - The counter.
 * @returns A fresh id.
 * @example
 * ```ts
 * nextId({ next: 0 }); // 0
 * ```
 */
function nextId(ids: Ids): number {
  ids.next += 1;
  return ids.next - 1;
}

/**
 * Sorts a link target: http(s) is web; a scheme, `//host`, `#anchor` or nothing is text; any
 * other value is a project path.
 *
 * @param target - The `(target)` of a link.
 * @returns What it is.
 * @example
 * ```ts
 * linkTarget("javascript:alert(1)"); // "text"
 * ```
 */
export function linkTarget(target: string): LinkTarget {
  if (WEB.test(target)) return "web";
  if (target === "" || target.startsWith("#") || target.startsWith("//") || SCHEME.test(target)) {
    return "text";
  }
  return "path";
}

/**
 * Resolves a relative link against the folder of the file: `./` and `../` segments, a leading
 * `/` means the project root; fragments and queries are dropped.
 *
 * @param base - Folder of the Markdown file (`""` at the root).
 * @param target - The link target.
 * @returns The project path.
 * @example
 * ```ts
 * resolvePath(".moku/notes", "../captures/a.png#top"); // ".moku/captures/a.png"
 * ```
 */
export function resolvePath(base: string, target: string): string {
  const clean = target.split(/[#?]/)[0] ?? "";
  const parts = clean.startsWith("/") || base === "" ? [] : base.split("/");
  for (const segment of clean.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * True when a line starts a block other than a paragraph.
 *
 * @param line - A line.
 * @returns Whether the paragraph ends before it.
 * @example
 * ```ts
 * startsBlock("# Title"); // true
 * ```
 */
function startsBlock(line: string): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    line.trimStart().startsWith("```") ||
    RULE.test(line.replaceAll(" ", "")) ||
    LIST_LINE.test(line) ||
    QUOTE_LINE.test(line)
  );
}

/**
 * Reads a list from `start`; lines indented by 2+ spaces nest under the last item.
 *
 * @param lines - Every line.
 * @param start - First list line.
 * @param ids - Key counter.
 * @returns The list and the index after it.
 * @example
 * ```ts
 * readList(["- a", "  - b"], 0, { next: 0 }).list.items.length; // 1
 * ```
 */
function readList(lines: readonly string[], start: number, ids: Ids): { list: List; end: number } {
  const first = LIST_LINE.exec(lines[start] ?? "");
  const ordered = /\d/.test(first?.[2] ?? "");
  const list: List = { ordered, items: [] };
  let index = start;

  for (; index < lines.length; index += 1) {
    const match = LIST_LINE.exec(lines[index] ?? "");
    if (!match) break;
    const [, indent = "", marker = "", raw = ""] = match;
    const text = raw.trim();
    const markerOrdered = /\d/.test(marker);
    const last = list.items.at(-1);
    if (indent.length >= 2 && last !== undefined) {
      const children = last.children ?? { ordered: markerOrdered, items: [] };
      children.items.push({ id: nextId(ids), text, children: undefined });
      list.items[list.items.length - 1] = { ...last, children };
    } else if (markerOrdered === ordered) {
      list.items.push({ id: nextId(ids), text, children: undefined });
    } else {
      break;
    }
  }
  return { list, end: index };
}

/**
 * Reads a fenced code block from its opening fence; an unclosed fence runs to the end (trailing
 * blank lines dropped).
 *
 * @param lines - Every line.
 * @param start - The opening fence.
 * @returns The language, the code lines and the index after the block.
 * @example
 * ```ts
 * readFence(["```ts", "const a = 1;", "```"], 0); // { lang: "ts", code: ["const a = 1;"], end: 3 }
 * ```
 */
function readFence(
  lines: readonly string[],
  start: number
): { lang: string; code: string[]; end: number } {
  const lang = (lines[start] ?? "").trim().slice(3).trim();
  const close = lines.findIndex((line, index) => index > start && line.trim().startsWith("```"));
  if (close !== -1) return { lang, code: lines.slice(start + 1, close), end: close + 1 };

  const code = lines.slice(start + 1);
  while (code.length > 0 && code.at(-1)?.trim() === "") code.pop();
  return { lang, code, end: lines.length };
}

/**
 * Reads consecutive lines while a test holds, joined with spaces.
 *
 * @param lines - Every line.
 * @param start - First line.
 * @param take - Returns the text of a line that belongs, or undefined.
 * @returns The joined text and the index after it.
 * @example
 * ```ts
 * readJoined(["> a", "> b"], 0, line => QUOTE_LINE.exec(line)?.[1]); // { text: "a b", end: 2 }
 * ```
 */
function readJoined(
  lines: readonly string[],
  start: number,
  take: (line: string, index: number) => string | undefined
): { text: string; end: number } {
  const parts: string[] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    const part = take(lines[index] ?? "", index);
    if (part === undefined) break;
    parts.push(part.trim());
  }
  return { text: parts.join(" "), end: index };
}

/**
 * Splits Markdown into blocks.
 *
 * @param text - The Markdown.
 * @param ids - Key counter.
 * @returns The blocks.
 * @example
 * ```ts
 * parseBlocks("# T\n\ntext", { next: 0 }).map(block => block.kind); // ["heading", "paragraph"]
 * ```
 */
function parseBlocks(text: string, ids: Ids): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = HEADING.exec(line);
    if (line.trim() === "") {
      index += 1;
    } else if (heading) {
      const level = heading[1]?.length ?? 1;
      blocks.push({ id: nextId(ids), kind: "heading", level, text: (heading[2] ?? "").trim() });
      index += 1;
    } else if (line.trimStart().startsWith("```")) {
      const fence = readFence(lines, index);
      blocks.push({ id: nextId(ids), kind: "code", lang: fence.lang, lines: fence.code });
      index = fence.end;
    } else if (RULE.test(line.replaceAll(" ", ""))) {
      blocks.push({ id: nextId(ids), kind: "rule" });
      index += 1;
    } else if (LIST_LINE.test(line)) {
      const { list, end } = readList(lines, index, ids);
      blocks.push({ id: nextId(ids), kind: "list", list });
      index = end;
    } else if (QUOTE_LINE.test(line)) {
      const quote = readJoined(lines, index, next => QUOTE_LINE.exec(next)?.[1]);
      blocks.push({ id: nextId(ids), kind: "quote", text: quote.text });
      index = quote.end;
    } else {
      const start = index;
      const paragraph = readJoined(lines, start, (next, at) =>
        at > start && startsBlock(next) ? undefined : next
      );
      blocks.push({ id: nextId(ids), kind: "paragraph", text: paragraph.text });
      index = paragraph.end;
    }
  }
  return blocks;
}

/**
 * Reads the inline mark that starts at `start`, if any.
 *
 * @param text - The paragraph text.
 * @param start - Position of `` ` ``, `*`, `_` or `[`.
 * @param ids - Key counter.
 * @returns The piece and the position after it, or undefined when nothing closes.
 * @example
 * ```ts
 * markAt("**a** b", 0, { next: 0 })?.end; // 5
 * ```
 */
function markAt(text: string, start: number, ids: Ids): { piece: Inline; end: number } | undefined {
  const char = text[start];
  if (char === "`") {
    const close = text.indexOf("`", start + 1);
    if (close <= start + 1) return undefined;
    return {
      piece: { id: nextId(ids), kind: "code", text: text.slice(start + 1, close) },
      end: close + 1
    };
  }
  if (char === "*" && text[start + 1] === "*") {
    const close = text.indexOf("**", start + 2);
    if (close > start + 2) {
      const children = parseInline(text.slice(start + 2, close), ids);
      return { piece: { id: nextId(ids), kind: "strong", children }, end: close + 2 };
    }
  }
  if (char === "*" || char === "_") {
    const close = text.indexOf(char, start + 1);
    const inner = text.slice(start + 1, close);
    const wordStart = char === "*" || !/\w/.test(text[start - 1] ?? "");
    if (close <= start + 1 || inner.startsWith(" ") || !wordStart) return undefined;
    return {
      piece: { id: nextId(ids), kind: "em", children: parseInline(inner, ids) },
      end: close + 1
    };
  }
  if (char === "[") {
    const label = text.indexOf("](", start + 1);
    const close = label === -1 ? -1 : text.indexOf(")", label + 2);
    if (close === -1) return undefined;
    const piece: Inline = {
      id: nextId(ids),
      kind: "link",
      text: text.slice(start + 1, label),
      target: text.slice(label + 2, close)
    };
    return { piece, end: close + 1 };
  }
  return undefined;
}

/**
 * Splits a paragraph into inline pieces; an unclosed mark stays text.
 *
 * @param text - The paragraph text.
 * @param ids - Key counter.
 * @returns The pieces.
 * @example
 * ```ts
 * parseInline("use `a`", { next: 0 }).map(piece => piece.kind); // ["text", "code"]
 * ```
 */
function parseInline(text: string, ids: Ids): Inline[] {
  const pieces: Inline[] = [];
  let plain = "";
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);
    const mark = "`*_[".includes(char) ? markAt(text, index, ids) : undefined;
    if (mark === undefined) {
      plain += char;
      index += 1;
      continue;
    }
    if (plain !== "") pieces.push({ id: nextId(ids), kind: "text", text: plain });
    plain = "";
    pieces.push(mark.piece);
    index = mark.end;
  }
  if (plain !== "") pieces.push({ id: nextId(ids), kind: "text", text: plain });
  return pieces;
}

/**
 * Renders a link: web in a new tab without the opener, a path as a button, else text.
 *
 * @param piece - The link piece.
 * @param open - Opens a resolved project path.
 * @returns The element or text.
 * @example
 * ```ts
 * renderLink({ id: 0, kind: "link", text: "a", target: "https://a.b" }, open);
 * ```
 */
function renderLink(
  piece: Extract<Inline, { kind: "link" }>,
  open: (target: string) => void
): ComponentChildren {
  const kind = linkTarget(piece.target);
  if (kind === "web") {
    return (
      <a key={piece.id} href={piece.target} target="_blank" rel="noopener noreferrer">
        {piece.text}
      </a>
    );
  }
  if (kind === "path") {
    return (
      <button key={piece.id} type="button" data-link onClick={() => open(piece.target)}>
        {piece.text}
      </button>
    );
  }
  return piece.text;
}

/**
 * Renders inline pieces.
 *
 * @param pieces - The pieces.
 * @param open - Opens a resolved project path.
 * @returns The children.
 * @example
 * ```ts
 * <p>{renderInline(parseInline(text, ids), open)}</p>
 * ```
 */
function renderInline(
  pieces: readonly Inline[],
  open: (target: string) => void
): ComponentChildren {
  return pieces.map(piece => {
    if (piece.kind === "text") return piece.text;
    if (piece.kind === "code") return <code key={piece.id}>{piece.text}</code>;
    if (piece.kind === "link") return renderLink(piece, open);
    return h(piece.kind, { key: piece.id }, renderInline(piece.children, open));
  });
}

/**
 * Renders a list (and its nested list).
 *
 * @param list - The list.
 * @param inline - Renders the text of an item.
 * @param key - The element key.
 * @returns The `<ul>` or `<ol>`.
 * @example
 * ```ts
 * renderList(list, text => text, 3);
 * ```
 */
function renderList(list: List, inline: (text: string) => ComponentChildren, key: number): VNode {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {list.items.map(item => (
        <li key={item.id}>
          {inline(item.text)}
          {item.children !== undefined && renderList(item.children, inline, item.id)}
        </li>
      ))}
    </Tag>
  );
}

/**
 * Renders a fenced block with the shared highlighter (the language from the fence info).
 *
 * @param lang - The fence language ("ts", "json" …).
 * @param lines - The code lines.
 * @param key - The element key.
 * @returns The `<pre><code>` element.
 * @example
 * ```ts
 * renderFence("ts", ["const a = 1;"], 2);
 * ```
 */
function renderFence(lang: string, lines: readonly string[], key: number): VNode {
  const name = lang.toLowerCase();
  const tokens = tokenizeLines(lines.join("\n"), langOf(`fence.${FENCE_ALIASES[name] ?? name}`));
  const rendered: ComponentChildren[] = [];
  for (const [index, line] of tokens.entries()) {
    if (index > 0) rendered.push("\n");
    rendered.push(renderTokens(line));
  }
  return (
    <pre key={key} data-md-code data-lang={lang === "" ? undefined : lang}>
      <code>{rendered}</code>
    </pre>
  );
}

/**
 * Renders the safe Markdown subset as VNodes (never innerHTML). A relative link becomes a
 * button that calls `onOpenPath` with the path resolved against `base`.
 *
 * @param text - The Markdown.
 * @param onOpenPath - Opens a project path in Files.
 * @param base - Folder of the Markdown file, for relative links (`""` = the root).
 * @returns The `<div data-md>` element.
 * @example
 * ```ts
 * renderMarkdown(note.body, path => openOrLog(ctx, path, {}), ".moku/notes");
 * ```
 */
export function renderMarkdown(text: string, onOpenPath: (path: string) => void, base = ""): VNode {
  const ids: Ids = { next: 0 };
  /**
   * Opens a link target resolved against the file's folder.
   *
   * @param target - The link target.
   * @example
   * ```ts
   * open("../captures/a.png"); // onOpenPath(".moku/captures/a.png")
   * ```
   */
  const open = (target: string): void => {
    onOpenPath(resolvePath(base, target));
  };
  /**
   * Renders the inline marks of a text.
   *
   * @param source - The text.
   * @returns The children.
   * @example
   * ```ts
   * inline("**now**"); // [<strong>now</strong>]
   * ```
   */
  const inline = (source: string): ComponentChildren =>
    renderInline(parseInline(source, ids), open);

  return (
    <div data-md>
      {parseBlocks(text, ids).map(block => {
        if (block.kind === "heading")
          return h(`h${block.level}`, { key: block.id }, inline(block.text));
        if (block.kind === "code") return renderFence(block.lang, block.lines, block.id);
        if (block.kind === "list") return renderList(block.list, inline, block.id);
        if (block.kind === "quote")
          return <blockquote key={block.id}>{inline(block.text)}</blockquote>;
        if (block.kind === "rule") return <hr key={block.id} />;
        return <p key={block.id}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
