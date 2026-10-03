/**
 * @file flowView focus module — the neighbours strip (C6), 224 px, sliding up on focus: "Neighbours
 * of <id>", the walk hint, *Comes from N* (glyph, path, via outcome, frame of the last fire), *This
 * node* (name, You are here, kind, file, last visit; Code, Styles, Add note, Enter) and *Goes to N*
 * (outcome, target, waiting, frame, ›). A row click walks to it; ← → walk (Flow keys).
 */
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { FlowActions, FlowCtx, HistoryEntryJson } from "../types";
import { useFlowStore } from "../useFlowStore";
import { incoming, nodeKinds, outgoing, parentsOf, resolveStack } from "./graph";
import { entryKey, frameLabel } from "./trail";

/**
 * Props of `NeighboursStrip`.
 */
export type NeighboursStripProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The last history entry of every edge key.
 *
 * @param history - Entries, oldest first.
 * @param ctx - Domain context of flowView (for the graph).
 * @returns Edge key → entry.
 * @example
 * ```ts
 * lastFires(history, ctx).get("board/merge:done");
 * ```
 */
function lastFires(
  history: readonly HistoryEntryJson[],
  ctx: FlowCtx
): Map<string, HistoryEntryJson> {
  const fires = new Map<string, HistoryEntryJson>();
  const { graph } = ctx.state.data;
  if (graph === undefined) return fires;
  for (const entry of history) {
    const key = entryKey(entry, graph);
    if (key !== undefined) fires.set(key, entry);
  }
  return fires;
}

/**
 * The neighbours strip.
 *
 * @param props - Context and actions.
 * @returns The strip, or an empty fragment while it is closed.
 * @example
 * ```tsx
 * <NeighboursStrip ctx={ctx} actions={actions} />
 * ```
 */
export function NeighboursStrip(props: NeighboursStripProps): VNode {
  const { ctx, actions } = props;
  useFlowStore(ctx, state => state.view.revision);
  const { focus, data } = ctx.state;
  const item =
    focus.selected === undefined ? undefined : ctx.state.layout.result?.byKey[focus.selected];
  const id = item?.id;
  const [file, setFile] = useState<string>();

  useEffect(() => {
    setFile(undefined);
    if (id === undefined) return;
    let live = true;
    actions.inspector
      .fileOf(id)
      .then(found => {
        if (live) setFile(found?.path);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [actions, id]);

  const graph = data.graph;
  if (!focus.strip || item === undefined || id === undefined || graph === undefined)
    return <span data-closed="neighbours-strip" hidden />;
  if (item.kind !== "node" && item.kind !== "hub" && item.kind !== "frame")
    return <span data-closed="neighbours-strip" hidden />;

  const frames =
    ctx.state.layout.result?.frames.filter(frame =>
      parentsOf(graph, item.flow).includes(frame.id)
    ) ?? [];
  const goes = outgoing(graph, id, frames.length === 1 ? frames[0]?.id : undefined);
  const comes = incoming(graph, id);
  const fires = lastFires(data.history, ctx);
  /**
   * The frame label of the last fire of an edge.
   *
   * @param key - The edge key.
   * @returns The label, or undefined.
   * @example
   * ```ts
   * label("board/merge:done"); // "f1800"
   * ```
   */
  const label = (key: string): string | undefined => {
    const entry = fires.get(key);
    return entry === undefined ? undefined : frameLabel(entry, focus.frames);
  };
  const current = actions.focus.current() === id;
  const waiting = current ? (data.position?.waiting ?? []) : [];
  const visit = data.history.findLast(entry => resolveStack(graph, entry.next).at(-1)?.id === id);
  const slash = id.indexOf("/");
  const node = graph.flows[id.slice(0, slash)]?.nodes[id.slice(slash + 1)];
  const highlight = focus.highlight;

  return (
    <section data-flow="neighbours-strip" data-chrome="" aria-label={`Neighbours of ${id}`}>
      <header data-part="head">
        <strong>{`Neighbours of ${id}`}</strong>
        <span data-part="hint">Click a row to walk the graph ← → · Close Esc</span>
      </header>
      <div data-column="from">
        <p data-part="title">{`Comes from ${comes.length}`}</p>
        {comes.length === 0 && <p data-part="empty">Nothing leads here</p>}
        {comes.map((row, index) => (
          <button
            key={row.key}
            type="button"
            data-row=""
            data-outcome={row.outcome}
            data-highlight={highlight.side === "from" && highlight.index === index ? "" : undefined}
            onClick={() => actions.focus.select(row.from)}
          >
            <code data-part="path">{row.from}</code>
            <span data-part="via">
              {row.via === undefined ? row.outcome : `${row.outcome} · via ${row.via}`}
            </span>
            {label(row.key) !== undefined && <code data-part="frame">{label(row.key)}</code>}
          </button>
        ))}
      </div>
      <div data-column="this">
        <p data-part="title">This node</p>
        <strong data-part="name">{id.slice(slash + 1)}</strong>
        {current && <span data-tag="current">You are here</span>}
        <span data-part="kind">{nodeKinds(graph, id).join(" · ")}</span>
        <code data-part="file">{file ?? "no file"}</code>
        <span data-part="visit">
          {visit === undefined
            ? "not visited recently"
            : `last visit ${frameLabel(visit, focus.frames)}`}
        </span>
        <span data-part="buttons">
          <button type="button" onClick={() => actions.inspector.setTab("code")}>
            Code
          </button>
          <button type="button" onClick={() => actions.inspector.setTab("styles")}>
            Styles
          </button>
          <button type="button" onClick={() => actions.notes.edit({ from: { node: id } })}>
            Add note
          </button>
          {node?.subFlow !== undefined && (
            <button type="button" onClick={() => actions.flows.enter(item.key)}>
              Enter
            </button>
          )}
        </span>
      </div>
      <div data-column="to">
        <p data-part="title">{`Goes to ${goes.length}`}</p>
        {goes.map((row, index) => (
          <button
            key={row.key}
            type="button"
            data-row=""
            data-outcome={row.outcome}
            data-highlight={highlight.side === "to" && highlight.index === index ? "" : undefined}
            data-waiting={waiting.includes(row.outcome) ? "" : undefined}
            onClick={() => {
              if (row.to !== undefined) actions.focus.select(row.to);
            }}
          >
            <span data-part="outcome">{row.outcome}</span>
            <code data-part="path">
              {row.to ?? (row.exit === undefined ? "—" : `exit:${row.exit}`)}
            </code>
            {waiting.includes(row.outcome) && <span data-tag="waiting">waiting</span>}
            {label(row.key) !== undefined && <code data-part="frame">{label(row.key)}</code>}
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}
