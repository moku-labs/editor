/**
 * @file gameView plugin — the source of a picked element's layout style: a breadth-first search
 * of `.ts`/`.tsx` files through link.files (skipping `sourceSearch.skip`, at most `maxFiles`) for
 * the first line with `key="k"`, `key={"k"}` or `key: "k"`, then `style={ident}` on that line.
 * The block is the StyleBlockRef `{ kind: "const", name: ident }` (R8); the shared style edit
 * finds it in that file, or in the file the ident is imported from.
 */
import { linkPlugin } from "../../link";
import type { StyleBlockRef } from "../../panels/shared/style-edit";
import type { FileEntry } from "../../registry/protocol";
import type { GameViewCtx } from "../types";

/**
 * A searched source file.
 */
const SOURCE_FILE = /\.tsx?$/;

/**
 * `style={ident}` on a line.
 */
const STYLE_IDENT = /style=\{\s*([$A-Z_a-z][\w$]*)\s*\}/;

/**
 * Regex special characters of a key.
 */
const REGEX_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

/**
 * A named import list and its module specifier.
 */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

/**
 * Where a style search found the key.
 */
export type StyleSource = {
  /** The file with the key line. */
  readonly path: string;
  /** 1-based line of the key. */
  readonly line: number;
  readonly ref: StyleBlockRef;
  /** Files that may hold the block, in order: the key file, then the import candidates. */
  readonly files: readonly string[];
};

/**
 * The first line with the key in one of its three forms, and the style ident on it.
 *
 * @param text - A file text.
 * @param key - The ui key.
 * @returns The 1-based line and the ident (undefined without `style={…}`), or undefined.
 * @example
 * ```ts
 * matchKey('<Row key="hudRow" style={hudRow}>', "hudRow"); // { line: 1, ident: "hudRow" }
 * ```
 */
export function matchKey(
  text: string,
  key: string
): { line: number; ident: string | undefined } | undefined {
  const escaped = key.replaceAll(REGEX_SPECIAL, String.raw`\$&`);
  const quoted = `"${escaped}"`;
  const pattern = new RegExp(String.raw`\bkey(?:=(?:${quoted}|\{\s*${quoted}\s*\})|:\s*${quoted})`);
  const lines = text.split("\n");
  const index = lines.findIndex(line => pattern.test(line));
  if (index === -1) return undefined;
  return { line: index + 1, ident: STYLE_IDENT.exec(lines[index] ?? "")?.[1] };
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
 * Lists `.ts`/`.tsx` files breadth-first from the root, skipping the configured folders, up to
 * `maxFiles`.
 *
 * @param ctx - Domain context of gameView.
 * @returns The file paths in search order.
 */
async function listSourceFiles(ctx: GameViewCtx): Promise<string[]> {
  const { maxFiles, skip } = ctx.config.sourceSearch;
  const files = ctx.require(linkPlugin).files;
  const queue = [""];
  const found: string[] = [];

  for (let next = 0; next < queue.length && found.length < maxFiles; next += 1) {
    let entries: readonly FileEntry[];
    try {
      entries = await files.list(queue[next] ?? "");
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      if (entry.kind === "dir") {
        if (!skip.includes(name)) queue.push(entry.path);
      } else if (SOURCE_FILE.test(entry.path) && found.length < maxFiles) {
        found.push(entry.path);
      }
    }
  }
  return found;
}

/**
 * Searches the source of a ui key's layout style.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns The key file, line, const ref and the files that may hold the block; undefined when
 * no file has the key with a style.
 */
export async function findStyleSource(
  ctx: GameViewCtx,
  key: string
): Promise<StyleSource | undefined> {
  const files = ctx.require(linkPlugin).files;
  for (const path of await listSourceFiles(ctx)) {
    let text: string;
    try {
      const file = await files.read(path);
      text = file.text;
    } catch {
      continue;
    }
    const match = matchKey(text, key);
    if (match?.ident === undefined) continue;

    return {
      path,
      line: match.line,
      ref: { kind: "const", name: match.ident },
      files: [path, ...importCandidates(text, match.ident, path)]
    };
  }
  return undefined;
}
