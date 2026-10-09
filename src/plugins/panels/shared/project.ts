/**
 * @file Shared view module — what the views ask the project index (D-38, amendment N). The index
 * is the only source of code locations: a key the index does not know is shown as not in the
 * index, and an index that is off is shown once with its reason. No crawl, no rule, no list.
 */
import type { FileText, ProjectFound, ProjectState } from "../../registry/protocol";

/**
 * Structural `find` of a files client: link.files fits it.
 */
export type FindFiles = { find?(key: string): Promise<readonly ProjectFound[]> };

/**
 * A files client that can find a key and read a file.
 */
export type FindReadFiles = FindFiles & { read(path: string): Promise<FileText> };

/**
 * The first answer of a key with the text and version of its file, read after the answer.
 */
export type FreshFound = {
  readonly found: ProjectFound;
  readonly text: string;
  /** The version of the read: the one a write passes. */
  readonly version: string;
};

/**
 * Every answer of a key: the ones in the file of its first answer, with the text and version of
 * that file read after the answers, and the later ones in other files.
 */
export type FreshAnswers = {
  /** The answers in the file of the first one, in the index's order; never empty. */
  readonly answers: readonly [ProjectFound, ...ProjectFound[]];
  /**
   * The later answers in other files, in the index's order; empty when every answer is in the
   * file of the first one. Their files are not read: `text` and `version` are not theirs. The
   * `hash` of each one says which version of its file its line and range are of.
   */
  readonly others: readonly ProjectFound[];
  readonly text: string;
  /** The version of the read: the one a write passes. */
  readonly version: string;
};

/**
 * The shared text of a key the index does not know (amendment N3).
 */
export const NOT_IN_INDEX_TEXT = "Not in the project index";

/**
 * The reason shown before the first project state arrives.
 */
const NO_STATE_REASON = "no state from the server yet";

/**
 * How many times `findFresh` asks the index: once, and once more when the file changed between
 * the answer and the read.
 */
const TRIES = 2;

/**
 * The key prefix of a text style the game defines.
 */
const TEXT_STYLE_KEY = "textStyle:";

/**
 * The answers of a key; none when `find` is missing or rejects.
 *
 * @param files - The files client.
 * @param key - A project-index key.
 * @returns The answers, in the index's order.
 */
async function answersOf(files: FindFiles, key: string): Promise<readonly ProjectFound[]> {
  try {
    return (await files.find?.(key)) ?? [];
  } catch {
    return [];
  }
}

/**
 * The text of a file, or undefined when the read rejects.
 *
 * @param files - The files client.
 * @param path - The root-relative file.
 * @returns The text and version, or undefined.
 */
async function readOrNothing(files: FindReadFiles, path: string): Promise<FileText | undefined> {
  try {
    return await files.read(path);
  } catch {
    return undefined;
  }
}

/**
 * Finds a key and reads its file. When the read version is not the `hash` of the answer, the file
 * changed in between: the index is asked once more and its answer is read again. That second
 * answer is kept even if the file changed again; its `version` is the read one, so a write made
 * from it is still version-checked. Never throws.
 *
 * @param files - The files client (link.files).
 * @param key - A project-index key, e.g. `"node:board/merge"` or `"jsx:settingsBoard"`.
 * @returns The first Found with the text and version of its file, or undefined when the index does
 * not know the key, `find` is missing or rejects, or the read rejects.
 * @example
 * ```ts
 * // The Code tab of the selected node opens its file at the definition.
 * const fresh = await findFresh(link.files, "node:board/merge");
 * if (fresh === undefined) return notFoundText(link.project(), "node:board/merge");
 * fresh.found.path; // "nodes/merge.ts"
 * fresh.found.line; // 17
 * ```
 */
export async function findFresh(
  files: FindReadFiles,
  key: string
): Promise<FreshFound | undefined> {
  const fresh = await findAllFresh(files, key);
  if (fresh === undefined) return undefined;

  const { answers, text, version } = fresh;
  return { found: answers[0], text, version };
}

/**
 * Finds a key and reads the file of its first answer, like `findFresh`, but keeps every answer:
 * the ones in that file as `answers` (the calls of a style function, `style:<path>#<function>`,
 * G2, answer one Found each), the later ones in other files as `others` (the patterns an id prop
 * fills in its component). The index is asked once for both. When the read version is not the
 * `hash` of the first answer, the index is asked once more, and the answers of that ask are kept.
 * Never throws.
 *
 * @param files - The files client (link.files).
 * @param key - A project-index key.
 * @returns The answers in the first answer's file with its text and version, and the answers in
 * other files; or undefined when the index does not know the key, `find` is missing or rejects, or
 * the read rejects.
 * @example
 * ```ts
 * // The style card of a picked element styled by a call of `signboardStyle`.
 * const fresh = await findAllFresh(link.files, "style:features/ui/kit.tsx#signboardStyle");
 * fresh?.answers.map(found => found.line); // [666, 668]: `defineStyle(board)`, `defineStyle({ … })`
 *
 * // The id prop `id="settingsBoard"`, and the panel its component draws in another file.
 * const board = await findAllFresh(link.files, "jsx:settingsBoard");
 * board?.answers[0].path; // "features/settings/settings.tsx"
 * board?.others.map(found => found.path); // ["shared/views/panels.tsx"]
 * ```
 */
export async function findAllFresh(
  files: FindReadFiles,
  key: string
): Promise<FreshAnswers | undefined> {
  let fresh: FreshAnswers | undefined;

  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    // No answer, or a file that cannot be read: nothing to show.
    const [first, ...rest] = await answersOf(files, key);
    if (first === undefined) return undefined;

    const read = await readOrNothing(files, first.path);
    if (read === undefined) return undefined;

    // The text read is of the answers in the first answer's file; the others keep their order.
    const answers: FreshAnswers["answers"] = [
      first,
      ...rest.filter(found => found.path === first.path)
    ];
    const others = rest.filter(found => found.path !== first.path);
    fresh = { answers, others, text: read.text, version: read.version };

    // The read is the text the index answered from: the lines match. Else the file changed in
    // between, and the index is asked once more.
    if (read.version === first.hash) return fresh;
  }

  // The file changed again: the last answer stays, its write is still version-checked.
  return fresh;
}

/**
 * The text-styles file of the game: the file that defines the most `textStyle:` keys; on a tie the
 * first path in sorted order. Both files of a conflict count.
 *
 * @param state - The project state (`link.project()`); undefined before the first.
 * @returns The path, or undefined when the index is off or defines no text style.
 * @example
 * ```ts
 * // The Styles tab picks the file whose text styles it edits.
 * textStylesFile(link.project()); // "features/ui/text-styles.ts"
 * ```
 */
export function textStylesFile(state: ProjectState | undefined): string | undefined {
  if (state?.state !== "on") return undefined;

  return mostDefined(countTextStyleDefs(state.defs));
}

/**
 * How many `textStyle:` keys each file defines; both files of a conflict count.
 *
 * @param defs - The defs map of an on project state.
 * @returns File → number of text styles it defines.
 * @example
 * ```ts
 * countTextStyleDefs({ "textStyle:ui.title": ["a.ts", "b.ts"], "textStyle:ui.body": ["a.ts"], "flow:main": ["f.ts"] });
 * // Map { "a.ts" => 2, "b.ts" => 1 }
 * ```
 */
function countTextStyleDefs(
  defs: Readonly<Record<string, readonly string[]>>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [key, paths] of Object.entries(defs)) {
    if (!key.startsWith(TEXT_STYLE_KEY)) continue;
    for (const path of new Set(paths)) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

/**
 * The path with the highest count; on a tie the first path in sorted order.
 *
 * @param counts - Path → count.
 * @returns The path, or undefined when there is none.
 * @example
 * ```ts
 * mostDefined(new Map([["b.ts", 2], ["a.ts", 2], ["c.ts", 1]])); // "a.ts"
 * ```
 */
function mostDefined(counts: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const path of [...counts.keys()].toSorted()) {
    const count = counts.get(path) ?? 0;
    if (count > bestCount) {
      best = path;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The files that use what a file defines: the use paths of every key defined in `path`, once each,
 * sorted, without `path` itself.
 *
 * @param state - The project state (`link.project()`); undefined before the first.
 * @param path - A root-relative file.
 * @returns The paths; empty when the index is off or nothing defined in the file is used.
 * @example
 * ```ts
 * // The Used by card of nodes/merge.ts lists the files that import the merge node.
 * usedIn(link.project(), "nodes/merge.ts"); // ["flows/board.ts"]
 * ```
 */
export function usedIn(state: ProjectState | undefined, path: string): readonly string[] {
  if (state?.state !== "on") return [];

  const users = new Set<string>();
  for (const [key, paths] of Object.entries(state.defs)) {
    if (!paths.includes(path)) continue;
    for (const user of state.uses[key] ?? []) users.add(user);
  }
  users.delete(path);

  return [...users].toSorted();
}

/**
 * The asset manifest of the game: the one the index found. The manifest has no other source.
 *
 * @param state - The project state (`link.project()`); undefined before the first.
 * @returns The root-relative manifest path, or undefined when the index is off or found none.
 * @example
 * ```ts
 * // The texture catalogue reads the manifest the index names.
 * const path = manifestOf(link.project()); // "public/manifest.json"
 * if (path !== undefined) await link.files.read(path);
 * ```
 */
export function manifestOf(state: ProjectState | undefined): string | undefined {
  return state?.state === "on" ? state.manifest : undefined;
}

/**
 * The one line a view shows when the index is off (amendment N2): `Project index is off: <reason>`.
 *
 * @param state - The project state (`link.project()`); undefined before the first.
 * @returns The text, or undefined when the index is on.
 * @example
 * ```ts
 * // The Flow inspector shows why it has no file for a node.
 * projectOffText(link.project()); // "Project index is off: typescript is not installed"
 * ```
 */
export function projectOffText(state: ProjectState | undefined): string | undefined {
  if (state === undefined) return `Project index is off: ${NO_STATE_REASON}`;

  return state.state === "off" ? `Project index is off: ${state.reason}` : undefined;
}

/**
 * The text of a key with no answer: why the index is off, or that the key is not in it.
 *
 * @param state - The project state (`link.project()`); undefined before the first.
 * @param key - The key that was asked.
 * @returns `Project index is off: <reason>` or `Not in the project index: <key>`.
 * @example
 * ```ts
 * // gameView picked an element whose JSX key is built from props.
 * notFoundText(link.project(), "jsx:cardRow"); // "Not in the project index: jsx:cardRow"
 * ```
 */
export function notFoundText(state: ProjectState | undefined, key: string): string {
  return projectOffText(state) ?? `${NOT_IN_INDEX_TEXT}: ${key}`;
}
