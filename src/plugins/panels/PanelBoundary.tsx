/**
 * @file panels plugin — the per-panel error boundary and the placeholder markup (waiting,
 * no-game, missing, error). A view that throws shows "This panel failed · <message>"; other
 * panels keep running. The view runs in a child component (`PanelView`): Preact hands a render
 * error to the nearest boundary above the component that threw, never to that component itself.
 */
import { Component, type ComponentChildren } from "preact";
import type { Json } from "../registry/protocol";
import type { PanelElement, PanelSpec, PanelTools } from "./types";

/**
 * The placeholder kinds of a panel section (generic F5, R4) plus the error state.
 */
export type PlaceholderState = "waiting" | "no-game" | "missing" | "error";

/**
 * Props of the placeholder line.
 */
export type PlaceholderProps = {
  readonly state: PlaceholderState;
  readonly text: string;
  readonly spinner: boolean;
};

/**
 * Props of the boundary: the panel, its values, its tools and the error callback.
 */
export type PanelBoundaryProps = {
  readonly panel: PanelSpec;
  readonly values: Readonly<Record<string, Json>>;
  readonly tools: PanelTools<Readonly<Record<string, string>>>;
  /** Called once when the view throws (mount.ts logs and marks the section). */
  readonly onError: (error: Error) => void;
};

/**
 * State of the boundary: the error a view threw, if any.
 */
export type PanelBoundaryState = { readonly error: Error | undefined };

/**
 * Props of the view runner.
 */
type PanelViewProps = Omit<PanelBoundaryProps, "onError">;

/**
 * An Error for anything thrown.
 *
 * @param thrown - What a view threw.
 * @returns The Error itself, or a new Error with its text.
 * @example
 * ```ts
 * asError("boom").message; // "boom"
 * ```
 */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * The one placeholder line of a section: `role="status"`, an optional spinner, the text.
 *
 * @param props - State, text and spinner flag.
 * @returns The placeholder element.
 * @example
 * ```tsx
 * <Placeholder state="waiting" text="Waiting for game.graph…" spinner />
 * ```
 */
export function Placeholder(props: PlaceholderProps): PanelElement {
  return (
    <p role="status" data-placeholder={props.state}>
      {props.spinner ? <span data-spinner="" aria-hidden="true" /> : undefined}
      {props.text}
    </p>
  );
}

/**
 * Runs the panel's view with its values and tools.
 *
 * @param props - Panel, values and tools.
 * @returns What the view returns.
 */
function PanelView(props: PanelViewProps): PanelElement {
  return props.panel.view(props.values, props.tools);
}

/**
 * Error boundary around one panel view.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  /**
   * Starts without an error.
   *
   * @param props - Boundary props.
   */
  constructor(props: PanelBoundaryProps) {
    super(props);
    this.state = { error: undefined };
  }

  /**
   * Turns a view error into boundary state.
   *
   * @param error - What the view threw.
   * @returns The new state.
   * @example
   * ```ts
   * PanelBoundary.getDerivedStateFromError(new Error("boom")); // { error }
   * ```
   */
  static override getDerivedStateFromError(error: unknown): Partial<PanelBoundaryState> {
    return { error: asError(error) };
  }

  /**
   * Reports the view error to the mount (log and section state).
   *
   * @param error - What the view threw.
   */
  override componentDidCatch(error: unknown): void {
    this.props.onError(asError(error));
  }

  /**
   * Renders the view, or the error placeholder.
   *
   * @returns The view or the placeholder.
   */
  override render(): ComponentChildren {
    const { error } = this.state;
    if (error !== undefined) {
      return (
        <Placeholder state="error" text={`This panel failed · ${error.message}`} spinner={false} />
      );
    }
    const { panel, values, tools } = this.props;
    return <PanelView panel={panel} values={values} tools={tools} />;
  }
}
