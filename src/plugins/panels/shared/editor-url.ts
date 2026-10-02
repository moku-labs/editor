/**
 * @file Shared view module — the "Open in editor" link (D-08, R9): flowView Code tab, filesView
 * file bar. The server never spawns a process.
 */

/**
 * Expands the editorUrl template: {path} = encodeURI(root + "/" + path) without a doubled
 * slash, {line} defaults to 1; undefined when template or root is empty.
 *
 * @param _template - ToolsBoot.editorUrl, e.g. "vscode://file/{path}:{line}".
 * @param _root - ToolsBoot.root.
 * @param _path - Relative file path.
 * @param _line - Optional 1-based line.
 * @example
 * ```ts
 * editorUrlOf("vscode://file/{path}:{line}", "/Users/alex/game", "nodes/merge.ts", 12);
 * ```
 */
export function editorUrlOf(
  _template: string,
  _root: string,
  _path: string,
  _line?: number
): string | undefined {
  throw new Error("not implemented");
}
