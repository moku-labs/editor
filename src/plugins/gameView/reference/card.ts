/**
 * @file gameView plugin — the compact reference and its card file (round 2b R13). The clipboard
 * gets one line: `@moku <name> <type> · <flow/node> · <file:line> · ref x,y w×h · <card path>`.
 * The card `<capturesDir>/<key>-f<frame>.md` holds the full reference block (round 2 R2), the
 * JSX and style snippets fenced with their `file:line` (an entity: its projection and components)
 * and the links to the crop and the full frame. A pick writes a new card (`-2`, `-3` … when
 * taken); "Copy reference" writes the card of its node and frame again, or a new one. A card that
 * cannot be written leaves its path out of the line.
 */
import { linkPlugin } from "../../link";
import type { PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { cardPath } from "../capture/naming";
import { listTaken } from "../capture/shot";
import { elementCode } from "../element/code";
import { messageOf } from "../report";
import type { CodeSnippet, ElementCode, GameViewCtx } from "../types";
import { type ReferenceFacts, referenceBlock, sourceText } from "./block";
import { referenceFacts } from "./facts";

/**
 * What a pick or "Copy reference" shares: the full block, the one line and the card it names.
 */
export type SharedReference = {
  readonly block: string;
  readonly line: string;
  readonly card: string | undefined;
};

/**
 * The fence languages of the snippet files, by extension.
 */
const FENCE_LANG: Readonly<Record<string, string>> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  css: "css",
  json: "json"
};

/**
 * A run of backticks in a snippet.
 */
const BACKTICKS = /`{3,}/g;

/**
 * The name a pick files its bookmark, crop and card under: the ui key, else the node name.
 *
 * @param node - The picked node.
 * @returns The name.
 */
export function nameOf(node: SceneNode): string {
  return node.key ?? node.name;
}

/**
 * A rect rounded as `x,y w×h`.
 *
 * @param rect - A rect.
 * @returns The text.
 */
function rectText(rect: PageRect): string {
  const [x, y, w, h] = [rect.x, rect.y, rect.w, rect.h].map(value => Math.round(value));
  return `${x},${y} ${w}×${h}`;
}

/**
 * Where the element is in the source: the key's `file:line` (`(loop)` for a loop key), else the
 * line that defines an entity's projection.
 *
 * @param facts - The facts.
 * @param code - The element's code.
 * @returns The place, undefined when not known.
 */
function placeOf(facts: ReferenceFacts, code: ElementCode | undefined): string | undefined {
  if (facts.source !== undefined) return sourceText(facts.source);
  const spawn = code?.kind === "entity" ? code.spawn : undefined;
  return spawn === undefined ? undefined : `${spawn.path}:${spawn.line}`;
}

/**
 * The one line on the clipboard; a field that is not known is left out.
 *
 * @param facts - The facts of the element.
 * @param code - Its code (an entity's projection definition).
 * @param card - The card file, undefined when none was written.
 * @returns `@moku <name> <type> · <flow/node> · <file:line> · ref x,y w×h · <card path>`.
 * @example
 * ```ts
 * referenceLine(facts, code, ".moku/captures/settingsBoard-f25.md");
 * // "@moku settingsBoard panel · settingsPopup/open · features/settings/settings.tsx:301 · ref 65,190 950×1060 · .moku/captures/settingsBoard-f25.md"
 * ```
 */
export function referenceLine(
  facts: ReferenceFacts,
  code: ElementCode | undefined,
  card: string | undefined
): string {
  const { node, position } = facts;
  const flowNode =
    position.flow !== undefined && position.node !== undefined
      ? `${position.flow}/${position.node}`
      : position.path;
  const ref = node.refRect === undefined ? undefined : `ref ${rectText(node.refRect)}`;
  const fields = [`@moku ${node.name} ${node.type}`, flowNode, placeOf(facts, code), ref, card];
  return fields.filter(field => field !== undefined).join(" · ");
}

/**
 * A fenced block one backtick longer than any run of backticks inside it.
 *
 * @param lines - The fenced lines.
 * @param lang - The fence language.
 * @returns The fence lines.
 */
function fenced(lines: readonly string[], lang: string): string[] {
  const longest = Math.max(
    2,
    ...lines.flatMap(line => [...line.matchAll(BACKTICKS)].map(run => run[0].length))
  );
  const fence = "`".repeat(longest + 1);
  return [`${fence}${lang}`, ...lines, fence];
}

/**
 * One snippet of the card: its heading with `file:line`, then the fenced lines.
 *
 * @param title - "JSX", "Style · coinPill".
 * @param snippet - The lines and where they are.
 * @returns The section lines.
 */
function snippetSection(title: string, snippet: CodeSnippet): string[] {
  const extension = snippet.path.slice(snippet.path.lastIndexOf(".") + 1).toLowerCase();
  return [
    `## ${title} · ${snippet.path}:${snippet.line}`,
    "",
    ...fenced(snippet.lines, FENCE_LANG[extension] ?? "")
  ];
}

/**
 * The code sections of the card: the JSX and the style, or an entity's projection and its
 * components.
 *
 * @param code - The element's code.
 * @returns The sections, each a list of lines.
 */
function codeSections(code: ElementCode | undefined): string[][] {
  if (code === undefined) return [];
  if (code.kind === "entity") {
    const { spawn } = code;
    const where = spawn === undefined ? "" : ` · ${spawn.path}:${spawn.line}`;
    const rows = code.components.map(row =>
      row.value === "" ? `- ${row.name}` : `- ${row.name}: ${row.value}`
    );
    return [[`## Spawned by ${code.projection}${where}`, "", ...rows]];
  }
  const sections: string[][] = [];
  if (code.jsx !== undefined) sections.push(snippetSection("JSX", code.jsx));
  if (code.style !== undefined) {
    sections.push(snippetSection(`Style · ${code.style.name}`, code.style));
  }
  return sections;
}

/**
 * The file name of a path, for a link from a card in the same folder.
 *
 * @param path - A file path.
 * @returns Its last segment.
 */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The card file of a reference: the full block, the code and the images of the pick.
 *
 * @param block - The full reference block.
 * @param facts - The facts it was built from (the node and the pick's files).
 * @param code - The element's code.
 * @returns The markdown text, ending with a newline.
 * @example
 * ```ts
 * cardText(block, facts, code).split("\n")[0]; // "# @moku settingsBoard panel"
 * ```
 */
export function cardText(
  block: string,
  facts: ReferenceFacts,
  code: ElementCode | undefined
): string {
  const { node, pick } = facts;
  const images = [
    pick?.crop === undefined ? undefined : `![element](${fileName(pick.crop)})`,
    pick?.full === undefined ? undefined : `![frame](${fileName(pick.full)})`
  ].filter(image => image !== undefined);
  const sections = [
    [`# @moku ${node.name} ${node.type}`],
    fenced(block.split("\n"), "text"),
    ...codeSections(code),
    ...(images.length === 0 ? [] : [images])
  ];
  return `${sections.map(section => section.join("\n")).join("\n\n")}\n`;
}

/**
 * The code of an element for its card; a failure leaves it out.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @returns The code, or undefined.
 */
async function codeOf(ctx: GameViewCtx, node: SceneNode): Promise<ElementCode | undefined> {
  try {
    return await elementCode(ctx, node);
  } catch {
    return undefined;
  }
}

/**
 * Writes the card of a reference: a new `<name>-f<frame>.md` for a pick, the one written before
 * for the same node and frame otherwise.
 *
 * @param ctx - Domain context of gameView.
 * @param facts - The facts (node and frame).
 * @param text - The card text.
 * @param fresh - True for a pick: always a new file.
 * @returns The card path, undefined when it could not be written (logged).
 */
async function writeCard(
  ctx: GameViewCtx,
  facts: ReferenceFacts,
  text: string,
  fresh: boolean
): Promise<string | undefined> {
  const { capturesDir } = ctx.config;
  const memo = `${facts.node.id}@${facts.frame}`;
  try {
    let path = fresh ? undefined : ctx.state.cards.get(memo);
    if (path === undefined) {
      const taken = await listTaken(ctx, capturesDir);
      path = cardPath(capturesDir, nameOf(facts.node), facts.frame, taken);
    }
    await ctx.require(linkPlugin).files.write(path, text);
    ctx.state.cards.set(memo, path);
    return path;
  } catch (error) {
    ctx.log.warn("gameView: reference card failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * The reference of one scene node for the chat: the full block, the card file with the code
 * and the images, and the one line that names the card.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @param scene - The scene it is in.
 * @param fresh - True for a pick: a new card file.
 * @returns The block, the line and the card path.
 */
export async function shareReference(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot,
  fresh: boolean
): Promise<SharedReference> {
  const [facts, code] = await Promise.all([referenceFacts(ctx, node, scene), codeOf(ctx, node)]);
  const block = referenceBlock(facts);
  const card = await writeCard(ctx, facts, cardText(block, facts, code), fresh);
  return { block, line: referenceLine(facts, code, card), card };
}
