/**
 * @file files plugin — classifyWrite: the `kind` of a `files:written` event, from the path.
 */
import type { WrittenKind } from "./types";

/**
 * Basenames that always hold styles.
 */
const STYLE_FILES = new Set(["styles.ts", "styles.tsx"]);

/**
 * True for a stylesheet or a styles module: `.css`, `styles.ts(x)` or `*.styles.ts(x)`.
 *
 * @param path - Relative posix path.
 * @returns Whether the path holds styles.
 * @example
 * ```ts
 * isStyle("ui/board.styles.ts"); // true
 * ```
 */
function isStyle(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    path.endsWith(".css") ||
    STYLE_FILES.has(name) ||
    path.endsWith(".styles.ts") ||
    path.endsWith(".styles.tsx")
  );
}

/**
 * Classifies a written path: capture, note, layout, style, code, other (first match wins).
 *
 * @param path - Relative posix path.
 * @returns The kind of the write.
 * @example
 * ```ts
 * classifyWrite("features/ui/styles.ts"); // "style"
 * classifyWrite(".moku/captures/a.png"); // "capture"
 * ```
 */
export function classifyWrite(path: string): WrittenKind {
  if (path.startsWith(".moku/captures/")) return "capture";
  if (path.startsWith(".moku/notes/")) return "note";
  if (path === ".moku/editor/layout.json") return "layout";
  if (isStyle(path)) return "style";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "code";

  return "other";
}
