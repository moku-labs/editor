/**
 * @file renderView components (cards) — the FPS card (spec 09 § M9): the rate now ("fps now") with
 * its tag (pinned, resting, or the display's target in warn below it), the sparkline of each column's
 * effective fps against the display rate, the rate switch with its lines, the adaptive rate changes in
 * view, and the missed frames and rate changes of the selection.
 */
import type { JSX } from "preact";
import type { CardsInput } from "../../derive/cards";
import { fpsCard } from "../../derive/cards";
import type { CardOff } from "../../derive/states";
import type { MonitorSection, RenderViewApi, RenderViewCtx } from "../../types";
import { LineText, lineKey } from "../parts";
import { RateSwitch } from "./RateSwitch";
import { cardValue, SparkCard } from "./SparkCard";

/**
 * Props of `FpsCard`.
 */
export type FpsCardProps = {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly input: CardsInput;
  readonly off: CardOff | undefined;
  readonly onTurnOn: (section: MonitorSection) => void;
};

/**
 * The FPS card.
 *
 * @param props - ctx, the api, the cards' input and the off panel.
 * @returns The card.
 */
export function FpsCard(props: FpsCardProps): JSX.Element {
  const { ctx, api, input } = props;
  const view = fpsCard(input);
  return (
    <SparkCard
      ctx={ctx}
      kind="fps"
      title="FPS"
      value={cardValue(view)}
      inSelection={view.inSelection}
      off={props.off}
      onTurnOn={props.onTurnOn}
    >
      <RateSwitch ctx={ctx} api={api} />
      {view.lines.map(line => (
        <p key={lineKey(line)}>
          <LineText line={line} />
        </p>
      ))}
    </SparkCard>
  );
}
