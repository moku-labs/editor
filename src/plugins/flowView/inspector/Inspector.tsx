/**
 * @file flowView inspector module — the Inspector (C1) inside the `flow.inspector` SidePanel:
 * Back (after a followed edge), kind glyph, path, clear ×, tags (kinds, "current", "showing
 * current · click a node"), the tabs Info, Code, Styles with ←/→ (`data-wide` while Code or
 * Styles shows: the panel's default width is 400 then), the tab bodies; the F5 string "Nothing to
 * inspect. Connect a game first." while no game is connected.
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import { useFlowStore } from "../useFlowStore";
import { CodeTab } from "./CodeTab";
import { InfoTab } from "./InfoTab";
import { StylesTab } from "./StylesTab";
import type { InfoView, InspectorTab } from "./types";

/**
 * Props of `Inspector`.
 */
export type InspectorProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  /** The node the Inspector shows (selected, else current). */
  readonly shown: NodeId | undefined;
  /** Its Info view. */
  readonly info: InfoView | undefined;
};

/**
 * The tabs in order.
 */
const TABS: readonly InspectorTab[] = ["info", "code", "styles"];

/**
 * The tab labels.
 */
const LABELS: Readonly<Record<InspectorTab, string>> = {
  info: "Info",
  code: "Code",
  styles: "Styles"
};

/**
 * The Inspector.
 *
 * @param props - Context, actions, the shown node and its info.
 * @returns The Inspector.
 */
export function Inspector(props: InspectorProps): VNode {
  const { ctx, actions, shown, info } = props;
  const tab = useFlowStore(ctx, state => state.inspector.tab);
  const { focus, data } = ctx.state;
  const status = data.status.kind;
  const stale = data.stale;

  const empty = status === "empty" || status === "connecting";
  if (info === undefined || (empty && focus.selected === undefined)) {
    return (
      <div data-flow="inspector" data-stale={stale ? "" : undefined}>
        <p data-part="placeholder">
          {empty ? "Nothing to inspect. Connect a game first." : "Select a node to inspect it."}
        </p>
      </div>
    );
  }

  return (
    <div
      data-flow="inspector"
      data-stale={stale ? "" : undefined}
      data-wide={tab === "code" || tab === "styles" ? "" : undefined}
    >
      <header data-part="head">
        {focus.back.length > 0 && (
          <button
            type="button"
            data-action="back"
            title="Back (Alt+←)"
            aria-label="Back"
            onClick={() => actions.focus.back()}
          >
            ‹
          </button>
        )}
        <span
          data-part="glyph"
          data-glyph={info.kinds.includes("sub-flow") ? "sub-flow" : info.kinds[0]}
          aria-hidden="true"
        />
        <code data-part="id">{info.id}</code>
        {focus.selected !== undefined && (
          <button
            type="button"
            data-action="clear"
            aria-label="Clear"
            onClick={() => actions.focus.leave()}
          >
            ×
          </button>
        )}
        <span data-part="tags">
          {info.kinds.map(kind => (
            <span key={kind} data-tag={kind}>
              {kind}
            </span>
          ))}
          {info.current && <span data-tag="current">current</span>}
          {focus.selected === undefined && (
            <span data-tag="showing-current">showing current · click a node</span>
          )}
        </span>
      </header>
      <div
        role="tablist"
        aria-label="Inspector tabs"
        data-part="tabs"
        onKeyDown={event => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.key === "ArrowRight" ? 1 : -1;
          const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] ?? "info";
          actions.inspector.setTab(next);
        }}
      >
        {TABS.map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => actions.inspector.setTab(name)}
          >
            {LABELS[name]}
          </button>
        ))}
      </div>
      {tab === "info" && <InfoTab ctx={ctx} actions={actions} info={info} />}
      {tab === "code" && <CodeTab ctx={ctx} actions={actions} id={shown} />}
      {tab === "styles" && <StylesTab ctx={ctx} actions={actions} scene={info.scene} />}
    </div>
  );
}
