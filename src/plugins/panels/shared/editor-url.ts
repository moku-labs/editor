/**
 * @file Shared view module — the "Open in editor" link (D-08, R9): flowView Code tab, filesView
 * file bar. The server never spawns a process.
 */

/**
 * Leading slashes of a path.
 */
const LEADING_SLASHES = /^\/+/;

/**
 * Drops the trailing slashes of a root (a loop, so a long run of slashes costs linear time).
 *
 * @param root - A directory path.
 * @returns The root without trailing slashes.
 * @example
 * ```ts
 * withoutTrailingSlashes("/home/dev/game//"); // "/home/dev/game"
 * ```
 */
function withoutTrailingSlashes(root: string): string {
  let end = root.length;
  while (end > 0 && root.charAt(end - 1) === "/") end -= 1;
  return root.slice(0, end);
}

/**
 * Expands the editorUrl template: {path} = encodeURI(root + "/" + path) with one slash at the
 * join and without its leading "/" (so `vscode://file/{path}` never doubles the slash; a Windows
 * root `C:/game` stays as is), {line} defaults to 1; undefined when template or root is empty.
 *
 * @param template - ToolsBoot.editorUrl, e.g. "vscode://file/{path}:{line}".
 * @param root - ToolsBoot.root.
 * @param path - Relative file path.
 * @param line - Optional 1-based line; anything but a positive integer reads as 1.
 * @returns The link, or undefined without a template or a root.
 * @example
 * ```ts
 * editorUrlOf("vscode://file/{path}:{line}", "/home/dev/game", "nodes/merge.ts", 12);
 * // "vscode://file/home/dev/game/nodes/merge.ts:12"
 * ```
 */
export function editorUrlOf(
  template: string,
  root: string,
  path: string,
  line?: number
): string | undefined {
  if (template === "" || root === "") return undefined;

  const joined = `${withoutTrailingSlashes(root)}/${path.replace(LEADING_SLASHES, "")}`;
  const encoded = encodeURI(joined.replace(LEADING_SLASHES, ""));
  const lineNumber = line !== undefined && Number.isInteger(line) && line > 0 ? line : 1;

  return template.replaceAll("{path}", encoded).replaceAll("{line}", String(lineNumber));
}
