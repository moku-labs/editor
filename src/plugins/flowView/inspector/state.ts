/**
 * @file flowView inspector module — state factory.
 */
import type { InspectorState } from "./types";

/**
 * Creates the inspector slice: Info tab, nothing loaded.
 *
 * @example
 * ```ts
 * createInspectorState().tab; // "info"
 * ```
 */
export function createInspectorState(): InspectorState {
  throw new Error("not implemented");
}
