/**
 * @file flowView inspector module — state factory.
 */
import type { InspectorState } from "./types";

/**
 * Creates the inspector slice: Info tab, nothing loaded.
 *
 * @returns The inspector state.
 */
export function createInspectorState(): InspectorState {
  return {
    tab: "info",
    code: undefined,
    codeNote: undefined,
    styles: undefined,
    sources: undefined,
    found: undefined
  };
}
