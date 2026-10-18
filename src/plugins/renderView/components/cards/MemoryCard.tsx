/**
 * @file renderView components (cards) — the Memory card (spec 09 § M9 Memory, "Memory source rule"):
 * the heap now from the one source the rule trusts (a wired phone's CDP heap, the local preview's
 * performance.memory; a WebView's own value never), Leak? or steady, the source line, the baseline
 * after GC with its slope, the heap's range in view, the process memory beside the heap (its
 * breakdown popover), the object counters, and the GCs of the selection. A source without a heap says
 * it is not measured on this device.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { togglePopover } from "../../actions/popover";
import { selectionTimes } from "../../derive/cards";
import { osOf } from "../../derive/connection";
import { spanWords } from "../../derive/inspector";
import type { MemoryInput } from "../../derive/memory";
import {
  baselineLine,
  breakdownOf,
  gcsInRangeText,
  heapRangeLine,
  memoryBaselines,
  memorySourceLine,
  memoryView,
  objectsLine,
  processLine
} from "../../derive/memory";
import { memoryInputOf } from "../../derive/mission";
import type { CardOff } from "../../derive/states";
import type { Line, Tag as TagWords } from "../../derive/words";
import { DASH, oneDecimal } from "../../derive/words";
import { notifyMission } from "../../state";
import type { MissionView, MonitorSection, RenderViewCtx } from "../../types";
import type { MissionIconName } from "../icons";
import { MissionIcon } from "../icons";
import { LineText } from "../parts";
import { MemoryBreakdown } from "./MemoryBreakdown";
import { SparkCard } from "./SparkCard";

/**
 * What the Memory card reads: the renderView context (Mission control's state, the active source),
 * the view's window, and the off panel when Memory & GC is switched off or not measured.
 */
export type MemoryCardProps = {
  /** The renderView context. */
  readonly ctx: RenderViewCtx;
  /** The view's start and end. */
  readonly window: { readonly startMs: number; readonly endMs: number };
  /** Why the card shows no data (section off, not measured), or undefined while it does. */
  readonly off: CardOff | undefined;
  /** Turns a monitoring section on, from the off panel's button. */
  readonly onTurnOn: (section: MonitorSection) => void;
};

/** The source line's icon by source. */
const SOURCE_ICONS: Readonly<Record<MissionView["memory"]["source"], MissionIconName>> = {
  cdp: "wire",
  "performance.memory": "laptop",
  shell: "phone",
  none: "gauge"
};

/**
 * The card's tag: Leak? (warn) when the baseline or an object counter keeps growing, steady (ok) when
 * a heap is read and nothing grows.
 *
 * @param leak - Leak? holds.
 * @param measured - A heap is read.
 * @returns The tags.
 */
function leakTags(leak: boolean, measured: boolean): TagWords[] {
  if (leak) return [{ text: "Leak?", tone: "warn", title: "The baseline after GC keeps growing" }];
  return measured ? [{ text: "steady", tone: "ok" }] : [];
}

/**
 * The GCs of the selection, in words.
 *
 * @param ctx - Domain context of renderView.
 * @param input - The Memory card's input.
 * @returns The line; undefined without a selection.
 */
function inSelection(ctx: RenderViewCtx, input: MemoryInput): string | undefined {
  const { mission } = ctx.state;
  if (mission.selection === undefined) return undefined;
  const times = selectionTimes(mission.history, mission.selection);
  return times === undefined ? undefined : gcsInRangeText(input, times.from, times.to);
}

/**
 * The Memory card of Mission control's card grid: the heap now with Leak? or steady, the heap's
 * sparkline with GC diamonds and the baseline trend, the source line, the baseline and range lines,
 * the process memory (a button to its breakdown on a wired phone) and the object counters.
 *
 * @param props - ctx, the view's window and the off panel.
 * @returns The card.
 */
export function MemoryCard(props: MemoryCardProps): JSX.Element {
  const { ctx, window } = props;
  const { mission } = ctx.state;
  const activeSource = ctx.require(activeSourcePlugin);
  const label = activeSource.label();
  const input = memoryInputOf(mission);
  const memory = memoryView(input);
  const measured = memory.source !== "none";
  const span = spanWords(mission.view.span);
  const ios = /iPhone|iPad|iPod/u.test(mission.second?.device?.userAgent ?? "");
  const baseline = baselineLine(memoryBaselines(input));
  const range = heapRangeLine(mission.series.heap, window.startMs, window.endMs, span);
  const process = processLine(memory.processMb);
  const breakdown = breakdownOf(mission.telemetry, Date.now()).length > 0;
  const open = mission.popover === "memory";
  const os = osOf(mission.second?.device) ?? "This device";
  return (
    <SparkCard
      ctx={ctx}
      kind="memory"
      title="Memory"
      wide
      value={{
        pairs: [
          { value: memory.heapMb === null ? DASH : oneDecimal(memory.heapMb), unit: "MB now" }
        ],
        tags: leakTags(memory.leak, measured)
      }}
      note={measured ? undefined : "Memory is not measured on this device"}
      inSelection={inSelection(ctx, input)}
      off={props.off}
      onTurnOn={props.onTurnOn}
    >
      <p data-part="source-line" data-measured={measured ? "" : undefined}>
        <MissionIcon name={SOURCE_ICONS[memory.source]} size={12} />
        {memorySourceLine(memory.source, { ios, link: label.link.kind })}
      </p>
      {measured ? undefined : (
        <p>{`${os} does not expose the JS heap or GC over this link. Frames, GPU and render stats still work.`}</p>
      )}
      {baseline === undefined ? undefined : (
        <p>
          <LineText line={baseline} warn={memory.leak} />
        </p>
      )}
      {range === undefined ? undefined : (
        <p>
          <LineText line={range} />
        </p>
      )}
      {process === undefined ? undefined : (
        <p data-part="process">
          <ProcessLine ctx={ctx} line={process} breakdown={breakdown} open={open} />
        </p>
      )}
      <p data-part="objects">
        <LineText line={objectsLine(mission.series.objects)} warn={memory.leak} />
      </p>
    </SparkCard>
  );
}

/**
 * The process memory line: a button that opens its breakdown when one is read, else the words.
 *
 * @param props - ctx, the line, whether a breakdown is read and whether it is open.
 * @param props.ctx - The renderView context.
 * @param props.line - The process line.
 * @param props.breakdown - A breakdown is read (a wired phone).
 * @param props.open - The breakdown popover is open.
 * @returns The line.
 */
function ProcessLine(props: {
  readonly ctx: RenderViewCtx;
  readonly line: Line;
  readonly breakdown: boolean;
  readonly open: boolean;
}): JSX.Element {
  const { ctx, line, breakdown, open } = props;
  const { mission } = ctx.state;
  if (!breakdown) return <LineText line={line} />;
  return (
    <span data-anchor>
      <button
        type="button"
        data-link-button
        data-popover-trigger="memory"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          togglePopover(mission, "memory");
          notifyMission(mission);
        }}
      >
        <LineText line={line} />
        <MissionIcon name="chevron" size={12} />
      </button>
      {open ? <MemoryBreakdown ctx={ctx} /> : undefined}
    </span>
  );
}
