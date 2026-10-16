/**
 * @file renderView components (cards) — the cards on the shared time axis (spec 09 § M9 Cards grid):
 * row 1 FPS, Frame time, Draw calls, Textures; row 2 GPU passes and Memory (two columns each); row 3
 * Device load across the grid. Every card reads the same view (span and end as the timeline) and the
 * same selection; a waiting source shows dashes, never zeros; a section that is off covers its cards
 * with "Turn on".
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import type { CardsInput } from "../../derive/cards";
import { drawCallsCard, frameTimeCard, gpuPassesCard, texturesCard } from "../../derive/cards";
import { memoryMeasured } from "../../derive/mission";
import { sectionsView } from "../../derive/monitoring";
import { activeProblems } from "../../derive/passes";
import { cardOff } from "../../derive/states";
import { passesSummaryOf } from "../../source/contract";
import type { MonitorSection, RenderViewApi, RenderViewCtx } from "../../types";
import { viewWindow } from "../../view/view";
import { timelineOverlay } from "../instrument/EmptyOverlay";
import { LineText, lineKey } from "../parts";
import { start } from "../start";
import { useRenderView } from "../useRenderView";
import { DeviceLoadCard } from "./DeviceLoadCard";
import { FpsCard } from "./FpsCard";
import { MemoryCard } from "./MemoryCard";
import { cardValue, SparkCard } from "./SparkCard";

/**
 * Props of `CardsGrid`.
 */
export type CardsGridProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * The cards grid.
 *
 * @param props - ctx and the api.
 * @returns The grid.
 */
export function CardsGrid(props: CardsGridProps): JSX.Element {
  const { ctx, api } = props;
  const { state } = ctx;
  const { mission } = state;
  useRenderView(state, () => state.assets);
  const name = ctx.require(activeSourcePlugin).label().name;
  const window = viewWindow(mission, performance.now());
  const overlay = timelineOverlay(ctx);
  const second = mission.second;
  const sections = sectionsView(second?.monitor, second?.caps, memoryMeasured(mission));
  const input: CardsInput = {
    history: mission.history,
    startMs: window.startMs,
    endMs: window.endMs,
    second,
    waiting: overlay !== undefined,
    selection: mission.selection
  };
  const onTurnOn = (section: MonitorSection): void => start(ctx, api.setSection(section, true));
  const frames = cardOff(overlay, "frames", sections?.frames, name);
  const render = cardOff(overlay, "render", sections?.render, name);
  const textures = texturesCard({
    ...input,
    assets: state.assets,
    count: state.render?.textures,
    textures: mission.series.textures
  });
  const frameTime = frameTimeCard(input);
  const draws = drawCallsCard(input);
  const gpu = gpuPassesCard({
    ...input,
    passes: mission.passes ? passesSummaryOf(mission.passes) : undefined,
    telemetry: mission.telemetry,
    issues: activeProblems(mission.history).length
  });
  return (
    <section data-render="cards" aria-label="Metrics on the same time axis">
      <FpsCard ctx={ctx} api={api} input={input} off={frames} onTurnOn={onTurnOn} />
      <SparkCard
        ctx={ctx}
        kind="frame"
        title="Frame time"
        value={cardValue(frameTime)}
        inSelection={frameTime.inSelection}
        off={frames}
        onTurnOn={onTurnOn}
      >
        {frameTime.lines.map(line => (
          <p key={lineKey(line)}>
            <LineText line={line} />
          </p>
        ))}
      </SparkCard>
      <SparkCard
        ctx={ctx}
        kind="draws"
        title="Draw calls"
        value={cardValue(draws)}
        inSelection={draws.inSelection}
        off={render}
        onTurnOn={onTurnOn}
      >
        {draws.lines.map(line => (
          <p key={lineKey(line)}>
            <LineText line={line} />
          </p>
        ))}
      </SparkCard>
      <SparkCard
        ctx={ctx}
        kind="textures"
        title="Textures"
        value={cardValue(textures)}
        inSelection={textures.inSelection}
        off={render}
        onTurnOn={onTurnOn}
      >
        {textures.share === null ? undefined : (
          <span data-bar aria-hidden="true">
            <span style={{ inlineSize: `${Math.round(textures.share * 100)}%` }} />
          </span>
        )}
        {textures.lines.map(line => (
          <p key={lineKey(line)}>
            <LineText line={line} />
          </p>
        ))}
      </SparkCard>
      <SparkCard
        ctx={ctx}
        kind="gpu"
        title="GPU passes"
        wide
        value={cardValue(gpu)}
        inSelection={gpu.inSelection}
        off={cardOff(overlay, "passes", sections?.passes, name)}
        onTurnOn={onTurnOn}
      >
        {gpu.lines.map(line => (
          <p key={lineKey(line)}>
            <LineText line={line} />
          </p>
        ))}
      </SparkCard>
      <MemoryCard
        ctx={ctx}
        window={window}
        off={cardOff(overlay, "memory", sections?.memory, name)}
        onTurnOn={onTurnOn}
      />
      <DeviceLoadCard ctx={ctx} off={cardOff(overlay, "render", "on", name)} onTurnOn={onTurnOn} />
    </section>
  );
}
