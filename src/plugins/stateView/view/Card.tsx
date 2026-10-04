/**
 * @file stateView plugin — one card of the State workspace: the section, its head with the title,
 * the card's own head content and the collapse toggle. The toggle shows and the collapse applies
 * only while the columns stack (container under 760 px, StateView.css); the choice lives as long
 * as the view.
 */
import type { ComponentChildren, VNode } from "preact";
import { useState } from "preact/hooks";

/**
 * Props of `Card`.
 *
 * @example
 * ```tsx
 * <Card part="session-card" title="Session" head={<span data-tag="mut">not saved</span>}>
 *   <JsonTree api={api} pageSize={100} value={session} root="session" commit={last} />
 * </Card>
 * ```
 */
export type CardProps = {
  /** The `data-part` of the section, e.g. "player-card". */
  readonly part: string;
  /** The head title and the section's aria-label. */
  readonly title: string;
  /** What the head shows after the title (tags, buttons). */
  readonly head?: ComponentChildren;
  /** The card body. */
  readonly children?: ComponentChildren;
};

/**
 * A card of the State workspace with its collapse toggle.
 *
 * @param props - The part, the title, the head content and the body.
 * @returns The section.
 * @example
 * ```tsx
 * <Card part="runner-card" title="Runner"><dl data-props="">…</dl></Card>
 * ```
 */
export function Card(props: CardProps): VNode {
  const { part, title, head, children } = props;
  const [collapsed, setCollapsed] = useState(false);
  const verb = collapsed ? "Expand" : "Collapse";

  return (
    <section
      data-card=""
      data-part={part}
      data-collapsed={collapsed ? "" : undefined}
      aria-label={title}
    >
      <header data-part="head">
        <h3>{title}</h3>
        {head}
        <button
          type="button"
          data-variant="ghost"
          data-size="sm"
          data-action="toggle-card"
          aria-expanded={!collapsed}
          aria-label={`${verb} ${title}`}
          title={`${verb} ${title}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </header>
      {children}
    </section>
  );
}
