/**
 * @file filesView plugin — the bar above a JSON file that does not parse: "Invalid JSON ·
 * <parser message>" (warn tone). Nothing for valid JSON.
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";

/**
 * Props of `JsonBar`.
 *
 * @example
 * ```tsx
 * <JsonBar text={text} />
 * ```
 */
export type JsonBarProps = { readonly text: string };

/**
 * The parser message of a JSON text, or undefined when it parses.
 *
 * @param text - The text.
 * @returns The message.
 * @example
 * ```ts
 * jsonProblem("{ nope"); // "JSON Parse error: …" (engine wording)
 * ```
 */
export function jsonProblem(text: string): string | undefined {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The invalid JSON bar.
 *
 * @param props - The file text.
 * @returns The bar, or nothing for valid JSON.
 * @example
 * ```tsx
 * <JsonBar text={text} />
 * ```
 */
export function JsonBar(props: JsonBarProps): VNode | undefined {
  const problem = useMemo(() => jsonProblem(props.text), [props.text]);
  if (problem === undefined) return undefined;
  return (
    <p data-part="preview" data-preview="json-bar" data-tone="warn" role="status">
      Invalid JSON · {problem}
    </p>
  );
}
