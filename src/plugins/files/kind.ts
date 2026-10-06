/**
 * @file files plugin — classifyWrite: the `kind` of a `files:written` event, from the path.
 */
import type { WrittenKind } from "./types";

/**
 * Basenames that always hold styles.
 */
const STYLE_FILES = new Set(["styles.ts", "styles.tsx"]);

/**
 * A module directly in a `styles/` folder: the layered game layout keeps its styles there
 * (`shared/styles/text.ts`, `features/<f>/styles/board.ts`), as the engine's hot plugin reads them.
 */
const STYLES_FOLDER = /(^|\/)styles\/[^/]+\.tsx?$/;

/**
 * True for a stylesheet or a styles module: `.css`, `styles.ts(x)`, `*.styles.ts(x)` or a module
 * directly in a `styles/` folder.
 *
 * @param path - Relative posix path.
 * @returns Whether the path holds styles.
 * @example
 * ```ts
 * isStyle("ui/board.styles.ts"); // true
 * isStyle("shared/styles/text.ts"); // true
 * ```
 */
function isStyle(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    path.endsWith(".css") ||
    STYLE_FILES.has(name) ||
    path.endsWith(".styles.ts") ||
    path.endsWith(".styles.tsx") ||
    STYLES_FOLDER.test(path)
  );
}

/**
 * Classifies a written path: capture, layout, style, code, other (first match wins).
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
  if (path === ".moku/editor/layout.json") return "layout";
  if (isStyle(path)) return "style";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "code";

  return "other";
}
