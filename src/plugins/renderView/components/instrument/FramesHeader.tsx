/**
 * @file renderView components (instrument) — the frames header (spec 09 § M8): "Frames", the "from"
 * chip naming the source, the headline of the view (refreshed at most 4 times a second), the warn tag
 * while the overdraw view is on, and the span switch 6 s / 30 s / 2 min.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { framesHeadline, restFpsOf } from "../../derive/header";
import { spanWords } from "../../derive/inspector";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { SPANS, viewWindow } from "../../view/view";
import { MissionIcon } from "../icons";
import { LineText } from "../parts";
import { useTicker } from "../useMission";

/**
 * Props of `FramesHeader`.
 */
export type FramesHeaderProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * Props of `FromChip`.
 */
export type FromChipProps = { readonly ctx: RenderViewCtx };

/**
 * The "from" chip: the source's icon and name in the source tint.
 *
 * @param props - ctx.
 * @returns The chip.
 */
export function FromChip(props: FromChipProps): JSX.Element {
  const activeSource = props.ctx.require(activeSourcePlugin);
  const source = props.ctx.state.mission.source ?? activeSource.current();
  return (
    <span data-from>
      <MissionIcon name={source.kind === "device" ? "phone" : "laptop"} size={12} />
      {activeSource.label().name}
    </span>
  );
}

/**
 * The frames header.
 *
 * @param props - ctx and the api.
 * @returns The header.
 */
export function FramesHeader(props: FramesHeaderProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const frames = mission.history.count > 0;
  useTicker(250, frames && mission.view.live);
  const view = api.mission();
  const window = viewWindow(mission, performance.now());
  const headline =
    view === undefined
      ? undefined
      : framesHeadline(view.stats, restFpsOf(mission.history, window.startMs, window.endMs));
  return (
    <header data-part="head">
      <h2>Frames</h2>
      <FromChip ctx={ctx} />
      <p data-headline>
        {headline === undefined ? (
          <span>No frames yet</span>
        ) : (
          headline.map(part => (
            <span key={part.key} data-part={part.key}>
              <LineText line={part.line} warn={part.warn} />
            </span>
          ))
        )}
      </p>
      {view?.overdraw === true ? (
        <span
          data-tag="warn"
          title="The overdraw heat map is on in the game: frame times are not representative"
        >
          Overdraw view on
        </span>
      ) : undefined}
      <span data-part="spacer" />
      {/* biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, styled as one group; it is no form, so no fieldset */}
      <div data-segmented="span" role="group" aria-label="Time span">
        {SPANS.map(span => (
          <button
            key={span}
            type="button"
            aria-pressed={mission.view.span === span}
            onClick={() => api.setSpan(span)}
          >
            {spanWords(span)}
          </button>
        ))}
      </div>
    </header>
  );
}
