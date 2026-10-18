/**
 * @file renderView components (connection) — the Monitoring popover (spec 09 § M7): "What is
 * monitored on {name}", one row per UI section with its switch (`role="switch"`, flipped only after
 * the answer: pending shows a spinner and `aria-busy`), "always on" for Frames and Render stats, the
 * unavailable rows with their reason, each row's measured cost or "cost not measured"; the footer's
 * total on the frame budget with its meter; the Debug views group with the overdraw heat map.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { memoryMeasured } from "../../derive/mission";
import type { MonitorRow } from "../../derive/monitoring";
import { monitoringRows, monitoringTotals } from "../../derive/monitoring";
import { commandAllowed } from "../../source/listed";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { BoldPart, Spinner } from "../parts";
import { start } from "../start";
import { useMissionApi } from "../useMission";
import { Popover, PopoverHead } from "./Popover";

/**
 * Props of `MonitoringPopover`.
 */
export type MonitoringPopoverProps = { readonly ctx: RenderViewCtx };

/**
 * Props of `SwitchRow`.
 */
type SwitchRowProps = {
  readonly title: string;
  readonly description: string;
  readonly nested: boolean;
  /** The switch: undefined for a row that is always on. */
  readonly control:
    | {
        readonly on: boolean;
        readonly disabled: boolean;
        readonly pending: boolean;
        readonly flip: () => void;
      }
    | undefined;
  readonly note: string | undefined;
  readonly cost: MonitorRow["cost"];
};

/**
 * One row: the switch (or "always on"), the title and description, the cost.
 *
 * @param props - The row.
 * @returns The row.
 */
function SwitchRow(props: SwitchRowProps): JSX.Element {
  const { control, note } = props;
  return (
    <li data-nested={props.nested ? "" : undefined}>
      {control === undefined ? (
        <span data-part="always">always on</span>
      ) : (
        <button
          type="button"
          role="switch"
          data-switch
          aria-checked={control.on}
          aria-label={props.title}
          aria-busy={control.pending ? "true" : undefined}
          disabled={control.disabled || control.pending}
          onClick={control.flip}
        >
          <span data-track />
          {control.pending ? <Spinner /> : undefined}
        </button>
      )}
      <div data-part="text">
        <b>{props.nested ? `↳ ${props.title}` : props.title}</b>
        <span>{props.description}</span>
        {note === undefined || note === "always on" || note === props.cost.text ? undefined : (
          <span data-part="why">{note}</span>
        )}
      </div>
      <span data-part="cost" data-tone={props.cost.tone}>
        {props.cost.text}
      </span>
    </li>
  );
}

/**
 * The switch of a section row.
 *
 * @param ctx - Domain context of renderView.
 * @param row - The row.
 * @param api - The renderView api.
 * @returns The switch; undefined for a row that is always on.
 */
function sectionControl(
  ctx: RenderViewCtx,
  row: MonitorRow,
  api: RenderViewApi
): SwitchRowProps["control"] {
  const pending = ctx.state.mission.sectionPending;
  if (row.note === "always on") return undefined;
  return {
    on: row.state === "on",
    disabled: !row.switchable,
    pending: pending === row.section,
    flip: () => start(ctx, api.setSection(row.section, row.state !== "on"))
  };
}

/**
 * The Monitoring popover.
 *
 * @param props - ctx.
 * @returns The popover.
 */
export function MonitoringPopover(props: MonitoringPopoverProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const api = useMissionApi(ctx);
  const name = ctx.require(activeSourcePlugin).label().name;
  const manifest = ctx.require(linkPlugin).manifest();
  const second = mission.second;
  const monitor = second?.monitor;
  const overdraw = monitor?.overdraw === true;
  return (
    <Popover ctx={ctx} id="monitoring" label="What is monitored">
      <div data-monitoring>
        <PopoverHead ctx={ctx} id="monitoring" title={`What is monitored on ${name}`} />
        {second === undefined || monitor === undefined ? (
          <p data-part="empty">The sections show once {name} sends its first second.</p>
        ) : (
          <MonitoringBody
            ctx={ctx}
            api={api}
            control={commandAllowed(manifest, "editor.perf.sections")}
          />
        )}
        <h4>Debug views</h4>
        <ul>
          <SwitchRow
            title="Overdraw heat map"
            description="Tints the game by how many times each pixel is drawn"
            nested={false}
            control={{
              on: overdraw,
              disabled: !commandAllowed(manifest, "game.debug"),
              pending: mission.sectionPending === "overdraw",
              flip: () => start(ctx, api.setOverdraw(!overdraw))
            }}
            note={undefined}
            cost={{ text: "frame times are not representative while it is on", tone: "warn" }}
          />
        </ul>
      </div>
    </Popover>
  );
}

/**
 * The section rows and the cost footer.
 *
 * @param props - ctx, the api and whether the build runs `editor.perf.sections`.
 * @param props.ctx - Domain context of renderView.
 * @param props.api - The renderView api.
 * @param props.control - The source's build runs the command.
 * @returns The rows and the footer.
 */
function MonitoringBody(props: {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly control: boolean;
}): JSX.Element | null {
  const { ctx, api, control } = props;
  const { mission } = ctx.state;
  const second = mission.second;
  const monitor = second?.monitor;
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (second === undefined || monitor === undefined) return null;
  const rows = monitoringRows({
    monitor,
    caps: second.caps,
    memoryMeasured: memoryMeasured(mission),
    control
  });
  const totals = monitoringTotals(
    monitor,
    rows,
    second.budgetMs,
    mission.source?.kind === "device"
  );
  const bold = totals.costMs === null ? "" : `~${totals.costMs} ms/frame`;
  return (
    <>
      <ul>
        {rows.map(row => (
          <SwitchRow
            key={row.section}
            title={row.title}
            description={row.description}
            nested={row.nested}
            control={sectionControl(ctx, row, api)}
            note={row.note}
            cost={row.cost}
          />
        ))}
      </ul>
      <footer>
        <p>
          <BoldPart text={totals.footer} bold={bold} />
        </p>
        {totals.meter === null ? undefined : (
          <span data-meter>
            <span style={{ inlineSize: `${totals.meter}%` }} />
          </span>
        )}
        <p>{totals.note}</p>
        {totals.editor === undefined ? undefined : <p>{totals.editor}</p>}
      </footer>
    </>
  );
}
