/**
 * @file renderView components (passes) — the Shaders & passes panel (spec 09 § M9): the headline
 * (passes a frame, programs, issues), three columns — the heaviest frame's passes with their chains,
 * targets and GPU (a share on a tile GPU), the shader programs with the compiles inside a frame (a
 * click selects that frame), and the active issues with their sentences — and the recording note.
 * Off, waiting and empty states say so.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { memoryMeasured } from "../../derive/mission";
import { sectionsView } from "../../derive/monitoring";
import {
  activeProblems,
  compilesOf,
  passRows,
  problemText,
  shaderChips
} from "../../derive/passes";
import type { PerfPassesSummary } from "../../source/contract";
import { passesSummaryOf } from "../../source/contract";
import { paintedScene } from "../../timeline/loop";
import { laneColourKey } from "../../timeline/scene";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { timelineOverlay } from "../instrument/EmptyOverlay";
import { FromChip } from "../instrument/FramesHeader";
import { start } from "../start";

/**
 * Props of `PassesPanel`.
 */
export type PassesPanelProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * The "Passes per frame" column.
 *
 * @param props - ctx and the passes summary.
 * @param props.ctx - Domain context of renderView.
 * @param props.summary - The second's passes summary.
 * @returns The column.
 */
function PassesColumn(props: {
  readonly ctx: RenderViewCtx;
  readonly summary: PerfPassesSummary | undefined;
}): JSX.Element {
  const { ctx, summary } = props;
  const rows = summary === undefined ? [] : passRows(summary);
  const scene = paintedScene(ctx.state.mission);
  return (
    <section data-part="column" data-column="passes">
      <h4>
        Passes per frame{" "}
        <span data-count>
          {summary?.tiler === true ? "share of the frame's GPU" : "GPU ms, measured"}
        </span>
      </h4>
      {rows.length === 0 ? (
        <p data-part="empty">No passes yet</p>
      ) : (
        <ul data-part="passes">
          {rows.map((row, index) => (
            <li key={row.key}>
              <i
                data-mark="square"
                data-colour={laneColourKey(scene, row.view, index)}
                aria-hidden="true"
              />
              <div data-part="text">
                <b>{row.label}</b>
                <span data-part="chain" title={row.chain}>
                  {row.chain}
                </span>
                <span>{row.target}</span>
              </div>
              <div data-part="ms">
                <b>{row.gpu}</b>
                {row.spikes === undefined ? undefined : <em>{row.spikes}</em>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The "Shader programs" column: the counters, and the compiles inside a frame.
 *
 * @param props - ctx, the api and the passes summary.
 * @param props.ctx - Domain context of renderView.
 * @param props.api - The renderView api.
 * @param props.summary - The second's passes summary.
 * @returns The column.
 */
function ShadersColumn(props: {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly summary: PerfPassesSummary | undefined;
}): JSX.Element {
  const { ctx, api, summary } = props;
  const { mission } = ctx.state;
  const chips = shaderChips(summary, mission.second?.display?.backend);
  const compiles = compilesOf(mission.history);
  return (
    <section data-part="column" data-column="shaders">
      <h4>Shader programs</h4>
      {chips.length === 0 ? undefined : (
        <p data-part="chips">
          {chips.map(chip => {
            const [count, ...rest] = chip.split(" ");
            return (
              <span key={chip}>
                <b>{count}</b> {rest.join(" ")}
              </span>
            );
          })}
        </p>
      )}
      <h4>
        Compiled inside a frame <span data-count>{compiles.rows.length}</span>
      </h4>
      {compiles.rows.length === 0 ? undefined : (
        <ul data-part="rows">
          {compiles.rows.map(row => (
            <li key={`${row.frame}:${row.label}`}>
              <button
                type="button"
                data-row
                onClick={() => api.select({ from: row.frame, to: row.frame })}
              >
                <i data-mark="diamond" data-colour="pickBlue" aria-hidden="true" />
                <span data-mono>{row.label}</span>
                <span data-part="grow">{row.sub}</span>
                <span data-part="meta" data-mono>
                  {row.ms}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {compiles.note === undefined ? undefined : <p data-part="note">{compiles.note}</p>}
    </section>
  );
}

/**
 * The "Issues" column: one warn row per active problem.
 *
 * @param props - ctx.
 * @param props.ctx - Domain context of renderView.
 * @returns The column.
 */
function IssuesColumn(props: { readonly ctx: RenderViewCtx }): JSX.Element {
  const { history } = props.ctx.state.mission;
  const problems = activeProblems(history);
  return (
    <section data-part="column" data-column="issues">
      <h4>
        Issues <span data-count>{problems.length}</span>
      </h4>
      {problems.length === 0 ? (
        <p data-part="empty">No issues</p>
      ) : (
        <ul data-part="issues">
          {problems.map(problem => {
            const text = problemText(problem, history);
            return (
              <li key={`${problem.rule}:${problem.owner ?? ""}:${problem.view ?? ""}`}>
                <MissionIcon name="gauge" size={14} />
                <div>
                  <b>{text.text}</b>
                  {text.sub === "" ? undefined : <p>{text.sub}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * What the panel shows instead of its columns: nothing running, waiting, or the section off.
 *
 * @param ctx - Domain context of renderView.
 * @returns The state; undefined when it shows the columns.
 */
function panelState(ctx: RenderViewCtx): "none" | "waiting" | "off" | undefined {
  const { mission } = ctx.state;
  const overlay = timelineOverlay(ctx);
  if (overlay === "not-started") return "none";
  if (overlay !== undefined) return "waiting";
  const second = mission.second;
  const sections = sectionsView(second?.monitor, second?.caps, memoryMeasured(mission));
  return sections?.passes === "off" ? "off" : undefined;
}

/**
 * The Shaders & passes panel.
 *
 * @param props - ctx and the api.
 * @returns The panel.
 */
export function PassesPanel(props: PassesPanelProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const name = ctx.require(activeSourcePlugin).label().name;
  const summary = mission.passes ? passesSummaryOf(mission.passes) : undefined;
  const state = panelState(ctx);
  const passes = summary?.heaviest?.passes.length;
  const programs = summary?.shaders?.pipelines;
  const issues = activeProblems(mission.history).length;
  return (
    <section data-render="passes" data-card aria-label="Shaders and passes">
      <header data-part="head">
        <h2>Shaders & passes</h2>
        <FromChip ctx={ctx} />
        <p data-headline>
          {passes === undefined ? undefined : (
            <span>
              <b>{passes}</b> passes a frame
            </span>
          )}
          {programs === undefined ? undefined : (
            <span>
              <b>{programs}</b> programs
            </span>
          )}
          {issues === 0 ? undefined : (
            <span>
              <b data-warn="">{issues}</b> issues
            </span>
          )}
        </p>
        <span data-part="note">The lane under the frames shares their time axis</span>
      </header>
      {state === "none" ? (
        <p data-off-message>No passes yet: start the local preview or connect a device.</p>
      ) : undefined}
      {state === "waiting" ? (
        <p data-off-message>Waiting for the first frames from {name}.</p>
      ) : undefined}
      {state === "off" ? (
        <p data-off-message>
          Shaders & passes is off: no passes, filters or compiles are collected.
          <button
            type="button"
            data-variant="primary"
            data-size="sm"
            data-action="turn-on"
            onClick={() => start(ctx, api.setSection("passes", true))}
          >
            Turn on
          </button>
        </p>
      ) : undefined}
      {state === undefined ? (
        <div data-part="columns">
          <PassesColumn ctx={ctx} summary={summary} />
          <ShadersColumn ctx={ctx} api={api} summary={summary} />
          <IssuesColumn ctx={ctx} />
        </div>
      ) : undefined}
      <footer>
        <span data-rec-ring aria-hidden="true" />A recording writes one line per pass summary and
        one per shader compile, so they can be read back later.
      </footer>
    </section>
  );
}
