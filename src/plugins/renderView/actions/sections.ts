/**
 * @file renderView actions — the Monitoring switches (spec 09 § M7): `editor.perf.sections` with
 * exactly a row's keys, flipped only after the answer (the answer's monitoring state is the truth
 * shown); Frames and Render stats are always on; a build without control toasts "Needs a debug build
 * to change what is monitored."; the overdraw view through `game.debug { overdraw }` (RE1).
 */
import { linkPlugin } from "../../link";
import { workspacePlugin } from "../../workspace";
import { memoryMeasured } from "../derive/mission";
import {
  alwaysOn,
  monitorStateOf,
  NEEDS_DEBUG,
  sectionsAnswerOf,
  sectionsInput,
  sectionsRefusalOf,
  sectionsView
} from "../derive/monitoring";
import { messageOf, reasonOf } from "../derive/words";
import { notifyMission } from "../state";
import type { MonitorSection, RenderViewCtx, SectionsAnswer } from "../types";

/**
 * Takes a monitoring state answered by the source: the second shows it until the next second.
 *
 * @param ctx - Domain context of renderView.
 * @param monitor - The answered state.
 */
function takeMonitor(ctx: RenderViewCtx, monitor: ReturnType<typeof monitorStateOf>): void {
  const { mission } = ctx.state;
  if (monitor === undefined || mission.second === undefined) return;
  mission.second = { ...mission.second, monitor };
}

/**
 * Runs a row's switch; never rejects. A second switch while one is pending answers Busy.
 *
 * @param ctx - Domain context of renderView.
 * @param section - The row.
 * @param on - On or off.
 * @returns The answer.
 * @example
 * ```ts
 * await runSection(ctx, "nodes", true); // editor.perf.sections { nodes: true } → { ok: true, text: "Nodes on", sections }
 * ```
 */
export async function runSection(
  ctx: RenderViewCtx,
  section: MonitorSection,
  on: boolean
): Promise<SectionsAnswer> {
  const { mission } = ctx.state;
  const input = sectionsInput(section, on);
  if (input === undefined) return alwaysOn(section === "frames" ? "frames" : "render");
  if (mission.sectionPending !== undefined) {
    return { ok: false, text: "Busy: a monitoring switch is still pending", sections: undefined };
  }
  const source = mission.source;
  mission.sectionPending = section;
  notifyMission(mission);
  let answer: SectionsAnswer;
  try {
    const { value } = await ctx.require(linkPlugin).run("editor.perf.sections", input);
    if (mission.source !== source) return sectionsAnswerOf(section, value, undefined, false);
    takeMonitor(ctx, monitorStateOf(value));
    answer = sectionsAnswerOf(section, value, mission.second?.caps, memoryMeasured(mission));
  } catch (error) {
    answer = sectionsRefusalOf(error);
    if (answer.text === NEEDS_DEBUG) ctx.require(workspacePlugin).toast(NEEDS_DEBUG);
    const second = mission.second;
    answer = {
      ...answer,
      sections: sectionsView(second?.monitor, second?.caps, memoryMeasured(mission))
    };
  }
  if (mission.source === source) mission.sectionPending = undefined;
  notifyMission(mission);
  return answer;
}

/**
 * Runs `game.debug { overdraw }`: the overdraw heat map on the source.
 *
 * @param ctx - Domain context of renderView.
 * @param on - On or off.
 * @returns The engine's flag after it (the old one on a refusal, with a toast).
 * @example
 * ```ts
 * await runOverdraw(ctx, true); // true: frames are tinted by how often each pixel is drawn
 * ```
 */
export async function runOverdraw(ctx: RenderViewCtx, on: boolean): Promise<boolean> {
  const { mission } = ctx.state;
  const old = mission.second?.monitor?.overdraw === true;
  mission.sectionPending = "overdraw";
  notifyMission(mission);
  try {
    const { value } = await ctx.require(linkPlugin).run("game.debug", { overdraw: on });
    const flag =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? value.overdraw
        : undefined;
    return typeof flag === "boolean" ? flag : old;
  } catch (error) {
    const reason = reasonOf(error);
    const refused = reason === "dev_only" || reason === "read_only";
    ctx
      .require(workspacePlugin)
      .toast(refused ? NEEDS_DEBUG : `Overdraw view refused: ${messageOf(error)}`);
    return old;
  } finally {
    if (mission.sectionPending === "overdraw") mission.sectionPending = undefined;
    notifyMission(mission);
  }
}
