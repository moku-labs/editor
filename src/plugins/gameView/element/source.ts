/**
 * @file gameView plugin — the source of a picked element (finding 5): a breadth-first search of
 * `.ts`/`.tsx` files through link.files, from the folder of the game page entry first, then the
 * root (skipping `sourceSearch.skip`, at most `maxFiles`), for a line with the ui key as
 * `key="k"`, `key={"k"}`, `key: "k"` or the `id` forms of a component, then its style anywhere in
 * the JSX element (to the line that closes it, eight lines at most). `style={ident}` is the
 * StyleBlockRef `{ kind: "const", name: ident }` (R8) the shared style edit finds in that file or
 * in the file the ident is imported from; `style={call(...)}` is shown read-only; an element with
 * no style is still "defined at" its line, a text node with `style="ui.link"` too, with its text
 * style key (round 2b R17: the Code section shows that key's block). A key no file names
 * literally that ends in digits is
 * looked for as built in a loop: the template literal of its stem (`card${` for "card0") is
 * "defined at" its line with `loop`. Every result is remembered per key in `state.found`; one
 * search per key runs at a time (`state.searches`).
 */
import { linkPlugin } from "../../link";
import type { FileEntry } from "../../registry/protocol";
import type { GameViewCtx, StyleSource } from "../types";

/**
 * A searched source file.
 */
const SOURCE_FILE = /\.tsx?$/;

/**
 * A plain identifier: the whole text of a `style={ident}`.
 */
const IDENT = /^[$A-Z_a-z][\w$]*$/;

/**
 * A call, possibly of a member: the start of a `style={call(...)}`.
 */
const CALL = /^[$A-Z_a-z][\w$.]*\s*\(/;

/**
 * The opening of a style attribute (not `data-style=`).
 */
const STYLE_OPEN = /(?<![\w$.-])style=\{/;

/**
 * A text style key as a string attribute: `style="ui.link"` (not `data-style=`).
 */
const TEXT_STYLE = /(?<![\w$.-])style="([^"]+)"/;

/**
 * A quoted string: the whole text of a `style={"ui.link"}`.
 */
const QUOTED = /^"([^"]+)"$/;

/**
 * A `>` that closes a JSX tag: not the arrow of `=>`.
 */
const CLOSES_TAG = /(?<!=)>/;

/**
 * The lines of one JSX element searched for its style, the key line included.
 */
const ELEMENT_LINES = 8;

/**
 * Regex special characters of a key.
 */
const REGEX_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

/**
 * The trailing characters of a key built in a loop.
 */
const DIGITS = "0123456789";

/**
 * A named import list and its module specifier.
 */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

/**
 * The style of an element: a plain identifier, a call shown as written (`…` when it goes on
 * past its line), or the text style key of a text node, with its 1-based line.
 */
export type KeyStyle =
  | { readonly kind: "ident"; readonly name: string; readonly line: number }
  | { readonly kind: "call"; readonly text: string; readonly line: number }
  | { readonly kind: "text"; readonly key: string; readonly line: number };

/**
 * The pattern of a key in its six forms: `key` or `id`, as `="k"`, `={"k"}` or `: "k"`.
 *
 * @param key - The ui key.
 * @returns The pattern.
 * @example
 * ```ts
 * keyPattern("hudRow").test('<Row key="hudRow">'); // true
 * ```
 */
export function keyPattern(key: string): RegExp {
  const escaped = key.replaceAll(REGEX_SPECIAL, String.raw`\$&`);
  const quoted = `"${escaped}"`;
  return new RegExp(
    String.raw`(?<![\w$.-])(?:key|id)(?:=(?:${quoted}|\{\s*${quoted}\s*\})|:\s*${quoted})`
  );
}

/**
 * The text inside the braces that open at `start`, up to the brace that closes them; the rest of
 * the line and `…` when they do not close on it.
 *
 * @param line - A line.
 * @param start - The index right after the opening brace.
 * @returns The text between the braces, trimmed.
 * @example
 * ```ts
 * bracedText("style={row({ gap: 4 })} />", 7); // "row({ gap: 4 })"
 * ```
 */
function bracedText(line: string, start: number): string {
  let depth = 1;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return line.slice(start, index).trim();
  }
  return `${line.slice(start).trim()}…`;
}

/**
 * The style attribute on one line: an identifier, a call or a text style key (`style="ui.link"`,
 * `style={"ui.link"}`); anything else (an inline object, a condition) is no style the search can
 * show.
 *
 * @param line - A line.
 * @param number - Its 1-based line number.
 * @returns The style, or undefined.
 * @example
 * ```ts
 * styleOn("  style={hudRow}", 5); // { kind: "ident", name: "hudRow", line: 5 }
 * styleOn('  style="ui.link"', 6); // { kind: "text", key: "ui.link", line: 6 }
 * ```
 */
function styleOn(line: string, number: number): KeyStyle | undefined {
  const textKey = TEXT_STYLE.exec(line)?.[1];
  if (textKey !== undefined) return { kind: "text", key: textKey, line: number };
  const open = STYLE_OPEN.exec(line);
  if (open === null) return undefined;

  const text = bracedText(line, open.index + open[0].length);
  if (IDENT.test(text)) return { kind: "ident", name: text, line: number };
  if (CALL.test(text)) return { kind: "call", text, line: number };
  const quoted = QUOTED.exec(text)?.[1];
  return quoted === undefined ? undefined : { kind: "text", key: quoted, line: number };
}

/**
 * The style of the JSX element whose key sits on a line: searched from that line to the line
 * that closes the tag, eight lines at most. On the key line only the text after the key can
 * close it.
 *
 * @param lines - The file lines.
 * @param index - The 0-based key line.
 * @param keyEnd - Where the key match ends on that line.
 * @returns The style, or undefined.
 */
function elementStyle(
  lines: readonly string[],
  index: number,
  keyEnd: number
): KeyStyle | undefined {
  const last = Math.min(lines.length, index + ELEMENT_LINES);
  for (let current = index; current < last; current += 1) {
    const line = lines[current] ?? "";
    const style = styleOn(line, current + 1);
    if (style !== undefined) return style;
    const rest = current === index ? line.slice(keyEnd) : line;
    if (CLOSES_TAG.test(rest)) return undefined;
  }
  return undefined;
}

/**
 * The key in a file: the first key line whose element has a style, else the first key line.
 *
 * @param text - A file text.
 * @param key - The ui key.
 * @returns The 1-based key line and its element's style, or undefined.
 * @example
 * ```ts
 * matchKey('<Row key="hudRow" style={hudRow}>', "hudRow"); // { line: 1, style: { kind: "ident", name: "hudRow", line: 1 } }
 * ```
 */
export function matchKey(
  text: string,
  key: string
): { line: number; style: KeyStyle | undefined } | undefined {
  const pattern = keyPattern(key);
  const lines = text.split("\n");
  let first: { line: number; style: undefined } | undefined;
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (match === null) continue;
    const style = elementStyle(lines, index, match.index + match[0].length);
    if (style !== undefined) return { line: index + 1, style };
    first ??= { line: index + 1, style: undefined };
  }
  return first;
}

/**
 * The stem of a key built in a loop: the key without its trailing digits.
 *
 * @param key - The ui key.
 * @returns The stem, undefined when the key has no trailing digits or nothing before them.
 * @example
 * ```ts
 * loopStem("card0"); // "card"
 * ```
 */
function loopStem(key: string): string | undefined {
  let end = key.length;
  while (end > 0 && DIGITS.includes(key.charAt(end - 1))) end -= 1;
  return end === key.length || end === 0 ? undefined : key.slice(0, end);
}

/**
 * The line that builds a key in a loop: a template literal that starts with the key's stem and
 * goes on with an interpolation (`` `card${slot}` `` for "card0", also as `key={`card${i}`}`).
 *
 * @param text - A file text.
 * @param key - The ui key; only a key that ends in digits after a stem has a loop form.
 * @returns The 1-based line, or undefined.
 * @example
 * ```ts
 * matchLoopKey("const id = `card${slot}`;", "card0"); // 1
 * ```
 */
export function matchLoopKey(text: string, key: string): number | undefined {
  const pattern = loopKeyPattern(key);
  if (pattern === undefined) return undefined;
  const index = text.split("\n").findIndex(line => pattern.test(line));
  return index === -1 ? undefined : index + 1;
}

/**
 * The pattern of the template literal that builds a key in a loop: a backtick, the key's stem,
 * then `${`.
 *
 * @param key - The ui key.
 * @returns The pattern, undefined when the key has no loop form (no trailing digits after a stem).
 * @example
 * ```ts
 * loopKeyPattern("card0")?.test("const id = `card${slot}`;"); // true
 * ```
 */
export function loopKeyPattern(key: string): RegExp | undefined {
  const stem = loopStem(key);
  if (stem === undefined) return undefined;

  const escaped = stem.replaceAll(REGEX_SPECIAL, String.raw`\$&`);
  return new RegExp(`\`${escaped}\\$\\{`);
}

/**
 * Joins a relative module specifier to the folder of a file.
 *
 * @param from - The importing file.
 * @param specifier - "./styles", "../kit/styles.ts".
 * @returns The joined path without a leading "./".
 * @example
 * ```ts
 * joinRelative("src/hud/Hud.tsx", "../kit/styles"); // "src/kit/styles"
 * ```
 */
function joinRelative(from: string, specifier: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/**
 * The files an imported style ident may come from: the relative import's `.ts`, `.tsx` and
 * `/index.ts`, or the path itself when it names its extension.
 *
 * @param text - The importing file's text.
 * @param ident - The local name of the style.
 * @param from - The importing file.
 * @returns Candidate paths; empty for a package import or an ident that is not imported.
 * @example
 * ```ts
 * importCandidates('import { coinPill } from "./styles";', "coinPill", "src/hud/Hud.tsx"); // ["src/hud/styles.ts", "src/hud/styles.tsx", "src/hud/styles/index.ts"]
 * ```
 */
export function importCandidates(text: string, ident: string, from: string): readonly string[] {
  for (const match of text.matchAll(NAMED_IMPORT)) {
    const names = (match[1] ?? "").split(",").map(name => name.split(" as ").at(-1)?.trim());
    const specifier = match[2] ?? "";
    if (!names.includes(ident) || !specifier.startsWith(".")) continue;

    const base = joinRelative(from, specifier);
    return SOURCE_FILE.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  }
  return [];
}

/**
 * The folder of the game page entry, from the page URL of the manifest, relative to the files
 * root; empty at the root, without a page or for a URL that does not parse.
 *
 * @param page - The page URL (absolute, or a path).
 * @returns The folder without leading or trailing slashes.
 * @example
 * ```ts
 * entryDirOf("http://127.0.0.1:3000/web/editor.html"); // "web"
 * ```
 */
export function entryDirOf(page: string | undefined): string {
  if (page === undefined) return "";
  try {
    const { pathname } = new URL(page, "http://localhost/");
    return decodeURIComponent(pathname.slice(1, pathname.lastIndexOf("/") + 1)).replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Lists one folder; a folder that cannot be listed is empty.
 *
 * @param ctx - Domain context of gameView.
 * @param dir - The folder, "" for the root.
 * @returns Its entries.
 */
async function listFolder(ctx: GameViewCtx, dir: string): Promise<readonly FileEntry[]> {
  try {
    return await ctx.require(linkPlugin).files.list(dir);
  } catch {
    return [];
  }
}

/**
 * Reads one file's text; a file that cannot be read is undefined.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The file.
 * @returns Its text, or undefined.
 */
export async function readText(ctx: GameViewCtx, path: string): Promise<string | undefined> {
  try {
    const file = await ctx.require(linkPlugin).files.read(path);
    return file.text;
  } catch {
    return undefined;
  }
}

/**
 * Queues the sub-folders of a listing that are neither skipped nor queued before.
 *
 * @param entries - The listing.
 * @param queue - The folders still to list.
 * @param seen - Every folder queued so far.
 * @param skip - Folder names never searched.
 */
function queueFolders(
  entries: readonly FileEntry[],
  queue: string[],
  seen: Set<string>,
  skip: readonly string[]
): void {
  for (const entry of entries) {
    if (entry.kind !== "dir" || seen.has(entry.path)) continue;
    seen.add(entry.path);
    if (!skip.includes(entry.path.slice(entry.path.lastIndexOf("/") + 1))) queue.push(entry.path);
  }
}

/**
 * Yields `.ts`/`.tsx` files breadth-first, folder by folder, from the game page entry's folder,
 * then the root (the entry folder is listed once), skipping the configured folders, up to
 * `maxFiles`. A folder that cannot be listed is skipped.
 *
 * @param ctx - Domain context of gameView.
 * @yields {string} The file paths in search order.
 */
export async function* sourceFiles(ctx: GameViewCtx): AsyncGenerator<string, void, undefined> {
  const { maxFiles, skip } = ctx.config.sourceSearch;
  const entry = entryDirOf(ctx.require(linkPlugin).manifest()?.page);
  const queue = entry === "" ? [""] : [entry, ""];
  const seen = new Set(queue);
  let found = 0;

  for (let next = 0; next < queue.length && found < maxFiles; next += 1) {
    const entries = await listFolder(ctx, queue[next] ?? "");
    queueFolders(entries, queue, seen, skip);
    for (const item of entries) {
      if (item.kind === "dir" || !SOURCE_FILE.test(item.path) || found >= maxFiles) continue;
      found += 1;
      yield item.path;
    }
  }
}

/**
 * The search result of one key match in a file.
 *
 * @param path - The file.
 * @param text - Its text.
 * @param match - The key line and its element's style.
 * @param match.line - The 1-based key line.
 * @param match.style - The style of the element, undefined for none.
 * @returns The style source.
 */
function sourceOf(
  path: string,
  text: string,
  match: { readonly line: number; readonly style: KeyStyle | undefined }
): StyleSource {
  const { line, style } = match;
  if (style?.kind === "ident") {
    const ref = { kind: "const", name: style.name } as const;
    return {
      kind: "ident",
      path,
      line,
      ref,
      files: [path, ...importCandidates(text, style.name, path)]
    };
  }
  if (style?.kind === "call")
    return { kind: "call", path, line, call: style.text, callLine: style.line };
  if (style?.kind === "text") return { kind: "defined", path, line, textStyle: style.key };
  return { kind: "defined", path, line };
}

/**
 * One search of a ui key over the source files: the first element with a style (a text style key
 * too) returns at once; else the first file that defines the key, else the first loop that
 * builds it.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns Where the key and its style are, undefined when no file names the key.
 */
async function searchSource(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  let defined: StyleSource | undefined;
  let loop: StyleSource | undefined;
  for await (const path of sourceFiles(ctx)) {
    const text = await readText(ctx, path);
    if (text === undefined) continue;

    const match = matchKey(text, key);
    if (match === undefined) {
      const line = loop === undefined ? matchLoopKey(text, key) : undefined;
      if (line !== undefined) loop = { kind: "defined", path, line, loop: true };
      continue;
    }
    const source = sourceOf(path, text, match);
    if (source.kind !== "defined" || source.textStyle !== undefined) return source;
    defined ??= source;
  }
  return defined ?? loop;
}

/**
 * Searches the source of a ui key: the first element with a style (an identifier or a call),
 * else the first file that defines the key, else the loop that builds it. The result is
 * remembered in `state.found`; a key no file names is forgotten there. A second call for a key
 * whose search still runs gets that search.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns Where the key and its style are, undefined when no file names the key.
 */
export function findStyleSource(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  const { found, searches } = ctx.state;
  const running = searches.get(key);
  if (running !== undefined) return running;

  const search = searchSource(ctx, key).then(
    source => {
      searches.delete(key);
      if (source === undefined) found.delete(key);
      else found.set(key, source);
      return source;
    },
    (error: unknown) => {
      searches.delete(key);
      throw error;
    }
  );
  searches.set(key, search);
  return search;
}
