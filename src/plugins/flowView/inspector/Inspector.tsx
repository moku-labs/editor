/**
 * @file flowView inspector module — the Inspector (C1): kind glyph, path, clear ×, tags (kinds,
 * "current", "showing current · click a node", "Note · idea for the agent"), the tabs Info, Code,
 * Styles, Notes (count) with ←/→, the tab bodies; 320 px, wider for Code and Styles; the F5 string
 * "Nothing to inspect. Connect a game first." while no game is connected.
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import { useFlowStore } from "../useFlowStore";
import { CodeTab } from "./CodeTab";
import { InfoTab } from "./InfoTab";
import { NotesTab } from "./NotesTab";
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
const TABS: readonly InspectorTab[] = ["info", "code", "styles", "notes"];

/**
 * The tab labels.
 */
const LABELS: Readonly<Record<InspectorTab, string>> = {
  info: "Info",
  code: "Code",
  styles: "Styles",
  notes: "Notes"
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
  const { focus, data, layout } = ctx.state;
  const selectedItem =
    focus.selected === undefined ? undefined : layout.result?.byKey[focus.selected];
  const status = data.status.kind;
  const stale = data.stale;
  const wide = tab === "code" || tab === "styles";
  const count = ctx.state.notes.files.filter(
    file => shown !== undefined && file.note?.from?.node === shown
  ).length;

  if (selectedItem?.kind === "note") {
    const note = ctx.state.notes.files.find(file => file.path === selectedItem.id)?.note;
    return (
      <aside data-flow="inspector" data-stale={stale ? "" : undefined} aria-label="Inspector">
        <header data-part="head">
          <code data-part="id">{selectedItem.id}</code>
          <button
            type="button"
            data-action="clear"
            aria-label="Clear"
            onClick={() => actions.focus.leave()}
          >
            ×
          </button>
          <span data-tag="note">Note · idea for the agent</span>
        </header>
        <div data-part="body">
          <strong>{note?.title ?? selectedItem.label}</strong>
          <p>{note?.body}</p>
        </div>
      </aside>
    );
  }

  const empty = status === "empty" || status === "connecting";
  if (info === undefined || (empty && focus.selected === undefined)) {
    return (
      <aside data-flow="inspector" data-stale={stale ? "" : undefined} aria-label="Inspector">
        <p data-part="placeholder">
          {empty ? "Nothing to inspect. Connect a game first." : "Select a node to inspect it."}
        </p>
      </aside>
    );
  }

  return (
    <aside
      data-flow="inspector"
      data-stale={stale ? "" : undefined}
      data-wide={wide ? "" : undefined}
      aria-label="Inspector"
    >
      <header data-part="head">
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
            {name === "notes" ? `${LABELS[name]} (${count})` : LABELS[name]}
          </button>
        ))}
      </div>
      {tab === "info" && <InfoTab ctx={ctx} actions={actions} info={info} />}
      {tab === "code" && <CodeTab ctx={ctx} actions={actions} id={shown} />}
      {tab === "styles" && <StylesTab ctx={ctx} actions={actions} scene={info.scene} />}
      {tab === "notes" && <NotesTab ctx={ctx} actions={actions} id={shown} />}
    </aside>
  );
}
