/**
 * @file panels plugin — the per-panel error boundary and the placeholder markup (waiting,
 * no-game, missing, error). A view that throws shows "This panel failed · <message>"; other
 * panels keep running.
 */
import { Component, type ComponentChildren } from "preact";
import type { Json } from "../registry/protocol";
import type { PanelSpec, PanelTools } from "./types";

/**
 * Props of the boundary: the panel, its values and its tools.
 */
export type PanelBoundaryProps = {
  readonly panel: PanelSpec;
  readonly values: Readonly<Record<string, Json>>;
  readonly tools: PanelTools<Readonly<Record<string, string>>>;
};

/**
 * State of the boundary: the error a view threw, if any.
 */
export type PanelBoundaryState = { readonly error: Error | undefined };

/**
 * Error boundary around one panel view.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  /**
   * Turns a view error into boundary state.
   *
   * @param _error - What the view threw.
   * @example
   * ```ts
   * PanelBoundary.getDerivedStateFromError(new Error("boom")); // { error }
   * ```
   */
  static override getDerivedStateFromError(_error: Error): Partial<PanelBoundaryState> {
    throw new Error("not implemented");
  }

  /**
   * Renders the view, or the error placeholder.
   *
   * @example
   * ```tsx
   * render(<PanelBoundary panel={spec} values={values} tools={tools} />, section);
   * ```
   */
  override render(): ComponentChildren {
    throw new Error("not implemented");
  }
}
