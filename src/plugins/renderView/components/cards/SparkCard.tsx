/**
 * @file renderView components (cards) — the sparkline card every metric card is (spec 09 § M9): the
 * title with the source mark ("From {name}"), the value line (value and unit, a second pair, tags),
 * the 46 px sparkline the loop paints on the shared axis (`data-paint="spark"`) with the cursor chip
 * of the hovered frame and an optional note over it, the footer lines, the "In selection" line, and
 * the panel that covers the card when it has nothing to show (not started, waiting, no monitor, its
 * section off with "Turn on").
 */
import type { ComponentChildren, JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import type { CardView, ReadoutKind } from "../../derive/cards";
import { readoutOf } from "../../derive/cards";
import type { CardOff } from "../../derive/states";
import type { Tag as TagWords } from "../../derive/words";
import type { MonitorSection, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Spinner, Tag } from "../parts";
import { useHoverFrame } from "../useMission";

/**
 * The value line of a card: values with their units and tags.
 *
 * @example
 * ```ts
 * const value: CardValue = { pairs: [{ value: "8.9", unit: "ms p50" }, { value: "14.2", unit: "ms p90" }], tags: [] };
 * ```
 */
export type CardValue = {
  readonly pairs: readonly { readonly value: string; readonly unit: string }[];
  readonly tags: readonly TagWords[];
};

/**
 * The value line of a derived card view: its value and unit, its second pair, its tags.
 *
 * @param view - The card view.
 * @returns The value line.
 * @example
 * ```ts
 * cardValue(frameTimeCard(input)).pairs.map(pair => pair.unit); // ["ms p50", "ms p90"]
 * ```
 */
export function cardValue(view: CardView): CardValue {
  const pairs = [{ value: view.value, unit: view.unit }];
  if (view.extra !== undefined) pairs.push(view.extra);
  const tags = [...(view.tag === undefined ? [] : [view.tag]), ...(view.tags ?? [])];
  return { pairs, tags };
}

/**
 * Props of `SparkCard`.
 */
export type SparkCardProps = {
  readonly ctx: RenderViewCtx;
  readonly kind: ReadoutKind & ("fps" | "frame" | "draws" | "textures" | "gpu" | "memory");
  readonly title: string;
  readonly value: CardValue;
  /** Two of the four columns (GPU passes, Memory). */
  readonly wide?: boolean;
  /** A note over the sparkline (Memory not measured). */
  readonly note?: string | undefined;
  readonly inSelection: string | undefined;
  readonly off: CardOff | undefined;
  /** Turns a section on (the off panel's "Turn on"). */
  readonly onTurnOn: (section: MonitorSection) => void;
  /** The footer's lines. */
  readonly children?: ComponentChildren;
};

/**
 * Props of `SourceMark`.
 */
export type SourceMarkProps = { readonly ctx: RenderViewCtx };

/**
 * The source mark at a card's top right: the source's icon titled "From {name}".
 *
 * @param props - ctx.
 * @returns The mark.
 */
export function SourceMark(props: SourceMarkProps): JSX.Element {
  const activeSource = props.ctx.require(activeSourcePlugin);
  const source = props.ctx.state.mission.source ?? activeSource.current();
  return (
    <span data-part="source" title={`From ${activeSource.label().name}`}>
      <MissionIcon name={source.kind === "device" ? "phone" : "laptop"} size={12} />
    </span>
  );
}

/**
 * Props of `OffPanel`.
 */
export type OffPanelProps = {
  readonly off: CardOff;
  readonly onTurnOn: (section: MonitorSection) => void;
};

/**
 * The panel that covers a card with nothing to show.
 *
 * @param props - What it says and its "Turn on".
 * @returns The panel.
 */
export function OffPanel(props: OffPanelProps): JSX.Element {
  const { off, onTurnOn } = props;
  const { turnOn } = off;
  return (
    <div data-off>
      {off.spinner ? <Spinner /> : undefined}
      <p>{off.title}</p>
      {off.body === undefined ? undefined : <span>{off.body}</span>}
      {turnOn === undefined ? undefined : (
        <button
          type="button"
          data-variant="primary"
          data-size="sm"
          data-action="turn-on"
          onClick={() => onTurnOn(turnOn)}
        >
          Turn on
        </button>
      )}
    </div>
  );
}

/**
 * A sparkline card.
 *
 * @param props - The card.
 * @returns The card.
 */
export function SparkCard(props: SparkCardProps): JSX.Element {
  const { ctx, kind, value, off } = props;
  const { mission } = ctx.state;
  const frame = useHoverFrame(mission);
  const readout =
    frame === undefined || off !== undefined ? undefined : readoutOf(kind, mission, frame);
  return (
    <article data-spark-card data-card-kind={kind} data-wide={props.wide === true ? "" : undefined}>
      <header>
        <h3>{props.title}</h3>
        <SourceMark ctx={ctx} />
      </header>
      <p data-part="value">
        {value.pairs.map(pair => (
          <span key={pair.unit} data-part="pair">
            <strong>{pair.value}</strong>
            <span data-part="unit">{pair.unit}</span>
          </span>
        ))}
        {value.tags.map(tag => (
          <Tag key={tag.text} tag={tag} />
        ))}
      </p>
      <div data-part="plot">
        <canvas data-paint="spark" data-spark={kind} />
        {readout === undefined ? undefined : <span data-cursor>{readout}</span>}
        {props.note === undefined ? undefined : <span data-part="note">{props.note}</span>}
      </div>
      <footer>
        {props.children}
        {props.inSelection === undefined ? undefined : (
          <p data-insel>In selection: {props.inSelection}</p>
        )}
      </footer>
      {off === undefined ? undefined : <OffPanel off={off} onTurnOn={props.onTurnOn} />}
    </article>
  );
}
