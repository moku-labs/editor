/**
 * @file gameView plugin — the source of a picked element, from the project index only (D-38,
 * amendment N): `find("jsx:<key>")` through link.files, and its first answer (the index orders
 * them: exact keys, then `{id}` patterns filled from an `id=` prop, then `*` patterns). The style
 * is the `style` attribute of the tag that opens the answer's range: `style={ident}` is the
 * StyleBlockRef `{ kind: "const", name: ident }` (R8) in the files the index defines
 * `style:<file>#<ident>` in, the key file first, then the file the ident is imported from;
 * `style={call(...)}` is shown read-only, with the `style:` key of the called function when the
 * index has one (G2); `style="ui.link"` names the text style key of a text node (round 2b R17);
 * an element with no style is still "defined at" the key line. A key the index does not know has
 * no source. Every answer is remembered per key in `state.found` until a project change drops it.
 */
import { linkPlugin } from "../../link";
import { type FreshFound, findFresh } from "../../panels/shared/project";
import type { ProjectState } from "../../registry/protocol";
import type { GameViewCtx, SourceRange, StyleSource } from "../types";
import { tagAttributes } from "./jsx";

/**
 * A file a relative import may name as it is.
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
 * A quoted string: the whole text of a `style={"ui.link"}`.
 */
const QUOTED = /^"([^"]+)"$/;

/**
 * The plain function a style call starts with: `roundStylesOf` in `roundStylesOf(size).icon`.
 */
const CALLED_FUNCTION = /^([$A-Z_a-z][\w$]*)\s*\(/;

/**
 * The property a style call reads from the result: `icon` in `roundStylesOf(size).icon`.
 */
const RESULT_PROPERTY = /\)\s*\.\s*([$A-Z_a-z][\w$]*)$/;

/**
 * A named import list and its module specifier.
 */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

/**
 * The prefix of a style key of the project index: `style:<file>#<name>`.
 */
const STYLE_KEY = "style:";

/**
 * The style of an element: a plain identifier, a call shown as written (`…` when it goes on
 * past its line), or the text style key of a text node, with the 1-based line of the attribute.
 */
export type KeyStyle =
  | { readonly kind: "ident"; readonly name: string; readonly line: number }
  | { readonly kind: "call"; readonly text: string; readonly line: number }
  | { readonly kind: "text"; readonly key: string; readonly line: number };

/**
 * The element file a style is looked up for: its path and its text.
 */
type ElementFile = { readonly path: string; readonly text: string };

/**
 * A call on one line: its first line and `…` when it goes on.
 *
 * @param text - The call as written.
 * @returns The call on one line.
 * @example
 * ```ts
 * firstLineOf("styles.row(\n  1\n)"); // "styles.row(…"
 * ```
 */
function firstLineOf(text: string): string {
  const end = text.indexOf("\n");
  return end === -1 ? text : `${text.slice(0, end).trim()}…`;
}

/**
 * The style of the element whose range an index answer gives: the `style` attribute of the tag
 * that opens the range, as an identifier, a call or a text style key (`style="ui.link"`,
 * `style={"ui.link"}`). Anything else (an inline object, a condition) is no style a card can show,
 * and a child's style is not the element's.
 *
 * @param lines - The file lines.
 * @param range - The answer's range.
 * @returns The style, or undefined.
 * @example
 * ```ts
 * // merge-game's order card (features/orders/strip.tsx, the answer of jsx:card0).
 * styleInRange(stripLines, [215, 5, 247, 14]); // { kind: "call", text: "orderCardStyle(card.slot)", line: 218 }
 * ```
 */
export function styleInRange(lines: readonly string[], range: SourceRange): KeyStyle | undefined {
  const style = tagAttributes(lines, range).find(attribute => attribute.name === "style");
  const value = style?.value;
  if (style === undefined || value === undefined) return undefined;
  const { line } = style;
  if (!value.braced) return { kind: "text", key: value.text, line };

  const { text } = value;
  if (IDENT.test(text)) return { kind: "ident", name: text, line };
  if (CALL.test(text)) return { kind: "call", text: firstLineOf(text), line };
  const quoted = QUOTED.exec(text)?.[1];
  return quoted === undefined ? undefined : { kind: "text", key: quoted, line };
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
 * Every file the index defines the style `name` in (`style:<file>#<name>`), in key order.
 *
 * @param project - The project state.
 * @param name - A style const, a style function, or `function.property` (G2).
 * @returns The files; empty when the index is off or defines none.
 * @example
 * ```ts
 * stylePaths(project, "coinPill"); // ["src/hud/styles.ts"]
 * ```
 */
function stylePaths(project: ProjectState | undefined, name: string): readonly string[] {
  if (project?.state !== "on") return [];

  const suffix = `#${name}`;
  return Object.keys(project.defs)
    .filter(key => key.startsWith(STYLE_KEY) && key.endsWith(suffix))
    .map(key => key.slice(STYLE_KEY.length, -suffix.length));
}

/**
 * The files the index defines a style in, nearest first: the element's own file, then the files
 * the element imports `binding` from by a relative path, then every other file that defines it.
 * A style imported through a tsconfig alias (`@shared`) is among those: the index follows the
 * aliases, and its `style:<file>#<name>` key names the file it resolved.
 *
 * @param project - The project state (`link.project()`).
 * @param element - The element's file and text.
 * @param binding - The local name the element uses: the ident, or the called function.
 * @param name - The style's name in its key: the ident, the function or `function.property`.
 * @returns The files, each once; empty when the index defines none.
 * @example
 * ```ts
 * // <Pill key="coinPill" style={coinPill} /> in src/hud/Hud.tsx, imported from "./styles".
 * styleFilesOf(project, { path: "src/hud/Hud.tsx", text }, "coinPill", "coinPill"); // ["src/hud/styles.ts"]
 * ```
 */
export function styleFilesOf(
  project: ProjectState | undefined,
  element: ElementFile,
  binding: string,
  name: string
): readonly string[] {
  const defined = stylePaths(project, name);
  const near = [element.path, ...importCandidates(element.text, binding, element.path)];
  return [...new Set([...near.filter(path => defined.includes(path)), ...defined])];
}

/**
 * The style key of a style call (G2): `style:<file>#<function>.<property>` for
 * `function(…).property`, else `style:<file>#<function>`, in the nearest file that defines it. A
 * call of a member (`styles.row(1)`) has none.
 *
 * @param project - The project state (`link.project()`).
 * @param element - The element's file and text.
 * @param call - The call as written.
 * @returns The key, undefined when the index has none.
 * @example
 * ```ts
 * callStyleKey(project, kit, "roundStylesOf(size).icon"); // "style:features/ui/kit.tsx#roundStylesOf.icon"
 * ```
 */
export function callStyleKey(
  project: ProjectState | undefined,
  element: ElementFile,
  call: string
): string | undefined {
  const called = CALLED_FUNCTION.exec(call)?.[1];
  if (called === undefined) return undefined;

  const property = RESULT_PROPERTY.exec(call)?.[1];
  const names = property === undefined ? [called] : [`${called}.${property}`, called];
  for (const name of names) {
    const [path] = styleFilesOf(project, element, called, name);
    if (path !== undefined) return `${STYLE_KEY}${path}#${name}`;
  }
  return undefined;
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
 * The source of an index answer and the text it was read from.
 *
 * @param fresh - The first answer of `jsx:<key>` with its file's text.
 * @param project - The project state (`link.project()`).
 * @returns The style source.
 */
function sourceOf(fresh: FreshFound, project: ProjectState | undefined): StyleSource {
  const { found, text } = fresh;
  const at = { path: found.path, line: found.line, range: found.range };
  const element = { path: found.path, text };
  const style = styleInRange(text.split("\n"), found.range);

  if (style?.kind === "ident") {
    const files = styleFilesOf(project, element, style.name, style.name);
    const ref = { kind: "const", name: style.name } as const;
    return { kind: "ident", ...at, ref, files: files.length > 0 ? files : [found.path] };
  }
  if (style?.kind === "call") {
    const call = { kind: "call", ...at, call: style.text, callLine: style.line } as const;
    const styleKey = callStyleKey(project, element, style.text);
    return styleKey === undefined ? call : { ...call, styleKey };
  }
  if (style?.kind === "text") return { kind: "defined", ...at, textStyle: style.key };
  return { kind: "defined", ...at };
}

/**
 * Asks the project index where a ui key is: its first answer, the style of that element and the
 * files of the style. The result is remembered in `state.found`; a key the index does not know
 * (or an index that is off or unreachable) is forgotten there. Never rejects.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns Where the key and its style are, undefined when the index has no answer.
 */
export async function findStyleSource(
  ctx: GameViewCtx,
  key: string
): Promise<StyleSource | undefined> {
  const link = ctx.require(linkPlugin);
  const fresh = await findFresh(link.files, `jsx:${key}`);
  const { found } = ctx.state;
  if (fresh === undefined) {
    found.delete(key);
    return undefined;
  }

  const source = sourceOf(fresh, link.project());
  found.set(key, source);
  return source;
}
