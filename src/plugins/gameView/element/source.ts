/**
 * @file gameView plugin — the source of a picked element, from the project index only (D-38,
 * amendment N): one `find("jsx:<key>")` through link.files, and its first answer (the index orders
 * them: exact keys, then `{id}` patterns filled from an `id=` prop, then `*` patterns). The first
 * answer is the source line (D-47). The style is the `style` attribute of the tag that opens the
 * answer's range; when the first answer is an id prop with no style on its tag
 * (`amountKey="giftReward"` on `<Amount>`), it is the style of the element the component draws
 * for it: the first later answer of the same ask whose pattern the prop fills (`{amountKey}`) in
 * the component of its name, whose file is still the version the index answered from, and whose
 * tag has a style. A pattern in a helper names no component and is never taken; neither is a `*`
 * pattern that only reads as the key. The component files that gave no style are kept on the
 * source, so a change to one of them asks again. `style={ident}` is the StyleBlockRef
 * `{ kind: "const", name: ident }` (R8) in the files the index defines `style:<file>#<ident>` in,
 * the file of the style first, then the file the ident is imported from; `style={call(...)}` is
 * shown read-only, with the `style:` key of the called function when the index has one (G2);
 * `style="ui.link"` names the text style key of a text node (round 2b R17); an element with no
 * style is still "defined at" the key line. A key the index does not know has no source. Every
 * answer is remembered per key in `state.found` until a project change drops it.
 */
import { linkPlugin } from "../../link";
import { type FreshAnswers, findAllFresh } from "../../panels/shared/project";
import type { FileText, ProjectFound, ProjectState } from "../../registry/protocol";
import type { GameViewCtx, SourceRange, StyleSource } from "../types";
import { tagAttributes } from "./jsx";

/**
 * A file a relative import may name as it is.
 */
const SOURCE_FILE = /\.tsx?$/;

/**
 * The extension of a relative import that names the built file (NodeNext): `./board.js`,
 * `./board.jsx`.
 */
const BUILT_FILE = /\.jsx?$/;

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
 * A named import list and its module specifier, also after a default name: `import { a } from`,
 * `import type { a } from`, `import Board, { a } from`.
 */
const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[$\w]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/**
 * A default import and its module specifier, also before a named list: `import Board from`,
 * `import type Board from`, `import Board, { a } from`.
 */
const DEFAULT_IMPORT =
  /import\s+(?:type\s+)?([$\w]+)\s*(?:,\s*\{[^}]*\}\s*)?\bfrom\s*["']([^"']+)["']/g;

/**
 * The space between the words of one entry of an import list.
 */
const SPACE = /\s+/;

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
 * A style and the file it was read from: the file of the first answer, or the component file of
 * an id prop.
 */
type StyledFile = ElementFile & { readonly style: KeyStyle };

/**
 * What looking for the style of a key gave: the style with its file, and the files of the
 * component answers that were looked at for it.
 */
type StyleFound = {
  /** The style and the file it is written in; undefined for an element without a style. */
  readonly styled: StyledFile | undefined;
  /** The file of each component answer looked at, in order; empty when none was. */
  readonly looked: readonly string[];
};

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
 * The source files a joined import path may be: the path itself when it names a source file
 * (`.ts`, `.tsx`); the `.ts` and `.tsx` of a built `.js`, the `.tsx` of a built `.jsx`; else the
 * file of that name, then the index file of a folder of that name.
 *
 * @param base - The joined path, as the import writes it.
 * @returns The candidate files, nearest first.
 * @example
 * ```ts
 * sourceFilesOf("features/ui/board"); // ["features/ui/board.ts", "features/ui/board.tsx", "features/ui/board/index.ts", "features/ui/board/index.tsx"]
 * sourceFilesOf("features/ui/board.js"); // ["features/ui/board.ts", "features/ui/board.tsx"]
 * sourceFilesOf("features/ui/board.jsx"); // ["features/ui/board.tsx"]
 * sourceFilesOf("features/ui/board.tsx"); // ["features/ui/board.tsx"]
 * ```
 */
function sourceFilesOf(base: string): readonly string[] {
  if (SOURCE_FILE.test(base)) return [base];
  if (!BUILT_FILE.test(base)) {
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  }

  const stem = base.replace(BUILT_FILE, "");
  return base.endsWith("x") ? [`${stem}.tsx`] : [`${stem}.ts`, `${stem}.tsx`];
}

/**
 * The local name of one entry of an import list, the name the importing file writes: the last
 * word of the entry, after an inline `type` and after `as`.
 *
 * @param entry - One entry, as written between the commas.
 * @returns The local name; empty for an empty entry.
 * @example
 * ```ts
 * localNameOf(" type Board "); // "Board"
 * localNameOf("coinPill as pill"); // "pill"
 * ```
 */
function localNameOf(entry: string): string | undefined {
  return entry.trim().split(SPACE).at(-1);
}

/**
 * The relative module specifier of the first import of one form that binds a local name.
 *
 * @param text - The importing file's text.
 * @param form - `NAMED_IMPORT` or `DEFAULT_IMPORT`: the names, then the specifier.
 * @param ident - The local name.
 * @returns The specifier, undefined when no relative import of that form binds the name.
 * @example
 * ```ts
 * relativeImportOf('import { type Board } from "../ui/board";', NAMED_IMPORT, "Board"); // "../ui/board"
 * relativeImportOf('import Board from "pkg";', DEFAULT_IMPORT, "Board"); // undefined
 * ```
 */
function relativeImportOf(text: string, form: RegExp, ident: string): string | undefined {
  for (const match of text.matchAll(form)) {
    const [, names = "", specifier = ""] = match;
    const isBound = names.split(",").some(entry => localNameOf(entry) === ident);
    if (isBound && specifier.startsWith(".")) return specifier;
  }
  return undefined;
}

/**
 * The files a name a file imports may come from: the source files (`sourceFilesOf`) of the
 * relative import that binds it. The name is the local one, the one the file writes: the alias of
 * `Name as Alias`, the name after an inline `type`, the name of a default import.
 *
 * @param text - The importing file's text.
 * @param ident - The local name: a style, or the component of a tag.
 * @param from - The importing file.
 * @returns Candidate paths; empty for a package import, a namespace import or a name that is not
 * imported.
 * @example
 * ```ts
 * importCandidates('import { coinPill } from "./styles";', "coinPill", "src/hud/Hud.tsx"); // ["src/hud/styles.ts", "src/hud/styles.tsx", "src/hud/styles/index.ts", "src/hud/styles/index.tsx"]
 * importCandidates('import { type Board as Panel } from "../ui/board.js";', "Panel", "src/hud/Hud.tsx"); // ["src/ui/board.ts", "src/ui/board.tsx"]
 * ```
 */
export function importCandidates(text: string, ident: string, from: string): readonly string[] {
  const specifier =
    relativeImportOf(text, NAMED_IMPORT, ident) ?? relativeImportOf(text, DEFAULT_IMPORT, ident);
  return specifier === undefined ? [] : sourceFilesOf(joinRelative(from, specifier));
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
 * Reads one file with its version; a file that cannot be read is undefined.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The file.
 * @returns Its text and version, or undefined.
 */
async function readFile(ctx: GameViewCtx, path: string): Promise<FileText | undefined> {
  try {
    return await ctx.require(linkPlugin).files.read(path);
  } catch {
    return undefined;
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
  const file = await readFile(ctx, path);
  return file?.text;
}

/**
 * True when a later answer is the element a component draws for an id prop: its pattern has the
 * hole of the prop (`{id}` for `id=`, `{amountKey}` for `amountKey=`) and is written in a
 * component of the name the prop sits on. A pattern in a lower-case helper names no component:
 * the index cannot say which component calls it, so it is never taken. A `*` pattern has no hole:
 * it only reads as the key.
 *
 * @param first - The first answer: an id prop.
 * @param later - A later answer of the same key.
 * @returns Whether the prop fills the pattern in its component.
 * @example
 * ```ts
 * const first = { path: "daily-gift.tsx", key: "giftReward", kind: "idProp", component: "Amount", prop: "amountKey", line: 25, range: [23, 9, 29, 11], hash: "0f3c" } as const;
 * fillsPattern(first, { path: "amount.tsx", key: "{amountKey}", kind: "ident", component: "Amount", line: 35, range: [35, 7, 35, 78], hash: "9a1e" }); // true
 * fillsPattern(first, { path: "hud-pill.tsx", key: "{amountKey}", kind: "ident", line: 12, range: [12, 5, 12, 60], hash: "41c0" }); // false: a helper
 * fillsPattern(first, { path: "strip.tsx", key: "gift*", kind: "ident", stem: "gift", line: 216, range: [215, 5, 247, 14], hash: "77b2" }); // false
 * ```
 */
function fillsPattern(first: ProjectFound, later: ProjectFound): boolean {
  const { component } = first;
  const hole = `{${first.prop ?? "id"}}`;
  const isOfComponent = component !== undefined && later.component === component;
  return isOfComponent && (later.key?.includes(hole) ?? false);
}

/**
 * The later answers to look at for the style of an id prop: the patterns its prop fills in a
 * component of its name (`fillsPattern`), those in the file of the prop first, then those in
 * other files, each group in the index's order. When components of that name answer from more
 * than one file, the name does not say which one the prop is passed to: only the one in the file
 * of the prop, or in a file it imports the component from by a relative path, is taken. An import
 * that cannot be followed here (a tsconfig alias, a barrel) then takes none.
 *
 * @param fresh - Every answer of `jsx:<key>`, the first one an id prop, with its file's text.
 * @returns The answers of the component the prop is passed to.
 * @example
 * ```ts
 * // settings.tsx passes the id to the Board it imports from "../ui/board"; the shop has a Board too.
 * const prop = { path: "features/settings/settings.tsx", key: "settingsBoard", kind: "idProp", component: "Board", prop: "id", line: 2, range: [2, 1, 2, 29], hash: "0f3c" } as const;
 * const panel = { key: "{id}", kind: "ident", component: "Board", line: 1, range: [1, 1, 1, 43], hash: "9a1e" } as const;
 * componentAnswers({
 *   answers: [prop],
 *   others: [{ ...panel, path: "features/shop/board.tsx" }, { ...panel, path: "features/ui/board.tsx" }],
 *   text: 'import { Board } from "../ui/board";\n<Board id="settingsBoard" />',
 *   version: "0f3c"
 * }).map(later => later.path); // ["features/ui/board.tsx"]
 * ```
 */
function componentAnswers(fresh: FreshAnswers): readonly ProjectFound[] {
  const [found, ...inFile] = fresh.answers;
  const filled = [...inFile, ...fresh.others].filter(later => fillsPattern(found, later));

  // One file writes a component of that name: the name says which one it is.
  const files = new Set(filled.map(later => later.path));
  const { component } = found;
  if (component === undefined || files.size < 2) return filled;

  const near = new Set([found.path, ...importCandidates(fresh.text, component, found.path)]);
  return filled.filter(later => near.has(later.path));
}

/**
 * The text a later answer was answered from: the text of the key file when the answer is in it,
 * else its own file, read now. Only the version the index answered from (the `hash` of the
 * answer) counts: in any other text the range of the answer is of other lines.
 *
 * @param ctx - Domain context of gameView.
 * @param fresh - The answers of the key with the text and version of the key file.
 * @param later - A later answer of the key.
 * @returns The text, undefined when the file cannot be read or is another version now.
 */
async function answeredText(
  ctx: GameViewCtx,
  fresh: FreshAnswers,
  later: ProjectFound
): Promise<string | undefined> {
  const file = later.path === fresh.answers[0].path ? fresh : await readFile(ctx, later.path);
  return file?.version === later.hash ? file.text : undefined;
}

/**
 * The style of the element a component draws for an id prop: the first answer of its component
 * (`componentAnswers`) whose file is the version the index answered from and whose tag has a
 * style, with the component file it is written in and the file of every answer looked at.
 *
 * @param ctx - Domain context of gameView.
 * @param fresh - Every answer of `jsx:<key>`, the first one an id prop, with its file's text.
 * @returns The style and its file (undefined when no such answer has a style) and the files
 * looked at.
 */
async function componentStyle(ctx: GameViewCtx, fresh: FreshAnswers): Promise<StyleFound> {
  const looked: string[] = [];
  for (const later of componentAnswers(fresh)) {
    const { path } = later;
    looked.push(path);

    const text = await answeredText(ctx, fresh, later);
    if (text === undefined) continue;

    const style = styleInRange(text.split("\n"), later.range);
    if (style !== undefined) return { styled: { path, text, style }, looked };
  }
  return { styled: undefined, looked };
}

/**
 * The style of a ui key: of the tag its first answer opens, else, for an id prop, of the element
 * its component draws for it.
 *
 * @param ctx - Domain context of gameView.
 * @param fresh - Every answer of `jsx:<key>` with the text of the first answer's file.
 * @returns The style and the file it is written in (undefined for an element without a style)
 * and the component files looked at.
 */
async function styleOf(ctx: GameViewCtx, fresh: FreshAnswers): Promise<StyleFound> {
  const [found] = fresh.answers;
  const { text } = fresh;
  const style = styleInRange(text.split("\n"), found.range);
  if (style !== undefined) return { styled: { path: found.path, text, style }, looked: [] };
  if (found.kind !== "idProp") return { styled: undefined, looked: [] };

  return componentStyle(ctx, fresh);
}

/**
 * The component files a source keeps: `stylePath` when the style was read from another file than
 * the key's, `stylelessPaths` for the other files looked at that gave none, each once.
 *
 * @param found - The first answer of `jsx:<key>`.
 * @param lookup - The style found for it and the component files looked at.
 * @returns The two fields; one that has nothing to say is left out.
 * @example
 * ```ts
 * // The component of an id prop in daily-gift.tsx draws its text without a style.
 * componentFiles(
 *   { path: "features/gift/popups/daily-gift.tsx", key: "giftReward", kind: "idProp", component: "Amount", prop: "amountKey", line: 25, range: [23, 9, 29, 11], hash: "0f3c" },
 *   { styled: undefined, looked: ["shared/views/amount.tsx"] }
 * ); // { stylelessPaths: ["shared/views/amount.tsx"] }
 * ```
 */
function componentFiles(
  found: ProjectFound,
  lookup: StyleFound
): Pick<StyleSource, "stylePath" | "stylelessPaths"> {
  const { styled, looked } = lookup;
  const stylePath = styled?.path === found.path ? undefined : styled?.path;
  const styleless = [...new Set(looked)].filter(
    path => path !== found.path && path !== styled?.path
  );
  return {
    ...(stylePath === undefined ? {} : { stylePath }),
    ...(styleless.length === 0 ? {} : { stylelessPaths: styleless })
  };
}

/**
 * The files that may hold the block of a style ident, in order: the ones the index defines it in
 * (`styleFilesOf`); the file the style is written in alone when the index defines none.
 *
 * @param project - The project state (`link.project()`).
 * @param styled - The style and the file it is written in.
 * @param name - The ident.
 * @returns The files; never empty.
 * @example
 * ```ts
 * // <Pill key="coinPill" style={coinPill} /> in src/hud/Hud.tsx, a style the index does not define.
 * blockFiles(project, { path: "src/hud/Hud.tsx", text, style }, "coinPill"); // ["src/hud/Hud.tsx"]
 * ```
 */
function blockFiles(
  project: ProjectState | undefined,
  styled: StyledFile,
  name: string
): readonly string[] {
  const files = styleFilesOf(project, styled, name, name);
  return files.length > 0 ? files : [styled.path];
}

/**
 * The source of a ui key: the place of its first answer (D-47) with the style found for it and
 * the component files that were read for it.
 *
 * @param found - The first answer of `jsx:<key>`.
 * @param lookup - The style and the file it is written in (undefined without a style), and the
 * component files looked at.
 * @param project - The project state (`link.project()`).
 * @returns The style source.
 */
function sourceOf(
  found: ProjectFound,
  lookup: StyleFound,
  project: ProjectState | undefined
): StyleSource {
  // The files of the component are kept for the line of its style and for its changes.
  const component = componentFiles(found, lookup);
  const at = { path: found.path, line: found.line, range: found.range, ...component };
  const { styled } = lookup;
  if (styled === undefined) return { kind: "defined", ...at };

  const { style } = styled;
  if (style.kind === "ident") {
    const ref = { kind: "const", name: style.name } as const;
    return { kind: "ident", ...at, ref, files: blockFiles(project, styled, style.name) };
  }
  if (style.kind === "call") {
    const call = { kind: "call", ...at, call: style.text, callLine: style.line } as const;
    const styleKey = callStyleKey(project, styled, style.text);
    return styleKey === undefined ? call : { ...call, styleKey };
  }
  return { kind: "defined", ...at, textStyle: style.key };
}

/**
 * Asks the project index once where a ui key is: its first answer, the style of that element (for
 * an id prop without one, the style of the element its component draws, from the later answers of
 * the same ask) and the files of the style. The result is remembered in `state.found`; a key the
 * index does not know (or an index that is off or unreachable) is forgotten there. Never rejects.
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
  const fresh = await findAllFresh(link.files, `jsx:${key}`);
  const { found } = ctx.state;
  if (fresh === undefined) {
    found.delete(key);
    return undefined;
  }

  const lookup = await styleOf(ctx, fresh);
  const source = sourceOf(fresh.answers[0], lookup, link.project());
  found.set(key, source);
  return source;
}
