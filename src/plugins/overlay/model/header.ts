/**
 * @file overlay plugin — the header (B1), the pill's label (C1), the link legend, STALE and the
 * engine line (B3). Pure.
 */
import { isLoopback, parseAddress } from "../../hub/protocol";
import type { PerfSecond, PerfStatus } from "../../perf/protocol";
import type { BuildInfo, BuildProfile } from "../../registry/protocol";
import type { LinkPayload } from "../types";
import { COLOUR, shortDuration } from "./format";
import type { EngineLineView, HeaderView, LinkLegend } from "./types";

/** The legend of a phone with no computer, or of a build without the bridge. */
const NO_PC: LinkLegend = { kind: "none", text: "NO PC", colour: COLOUR.ink };

/** The header's word for a resting screen, and the unit of its fps. */
const IDLE_WORD = "idle";
const FPS_WORD = "fps";

/**
 * The profile texts of the engine line.
 */
const PROFILE_TEXT: Readonly<Record<BuildProfile, string>> = {
  dev: "dev page",
  full: "debug, full control",
  read: "debug, read-only",
  none: "no agent flags"
};

/**
 * The link legend of the header and the pill: no bridge or no computer → NO PC; a dev page (no
 * device link) → DEV, green while live or paused; connecting → ADB or LAN by the address, amber;
 * adb / lan → green.
 *
 * @param payload - The last `bridge:status`.
 * @param hasBridge - Whether the bridge is composed.
 * @returns The legend.
 * @example
 * ```ts
 * linkLegend({ status: { kind: "live", frame: 12 } }, true); // { kind: "dev", text: "DEV", colour: "var(--live)" }
 * ```
 */
export function linkLegend(payload: LinkPayload | undefined, hasBridge: boolean): LinkLegend {
  if (!hasBridge) return NO_PC;

  const link = payload?.link;
  if (link === undefined) {
    const kind = payload?.status.kind;
    const live = kind === "live" || kind === "paused";
    return { kind: "dev", text: "DEV", colour: live ? COLOUR.live : COLOUR.ink };
  }

  switch (link.mode) {
    case "none": {
      return NO_PC;
    }
    case "connecting": {
      const host = parseAddress(link.address)?.host;
      const text = host !== undefined && isLoopback(host) ? "ADB" : "LAN";
      return { kind: "connecting", text, colour: COLOUR.caution };
    }
    case "adb": {
      return { kind: "adb", text: "ADB", colour: COLOUR.live };
    }
    default: {
      return { kind: "lan", text: "LAN", colour: COLOUR.live };
    }
  }
}

/**
 * STALE: the page's engine and the computer's are both known and differ.
 *
 * @param engine - The page's engine (`registry.build().engine`).
 * @param payload - The last `bridge:status`.
 * @returns Whether the phone runs another engine than the computer.
 * @example
 * ```ts
 * isStale("0.14.12+9c41e0", { status: { kind: "live", frame: 1 }, link: { mode: "lan", address: "a:1", editorEngine: "0.14.13+1ab7f2" } }); // true
 * ```
 */
export function isStale(engine: string | undefined, payload: LinkPayload | undefined): boolean {
  const editorEngine = payload?.link?.editorEngine;
  return typeof engine === "string" && typeof editorEngine === "string" && engine !== editorEngine;
}

/**
 * The profile text of the engine line.
 *
 * @param profile - The build profile.
 * @returns The text.
 * @example
 * ```ts
 * profileText("read"); // "debug, read-only"
 * ```
 */
export function profileText(profile: BuildProfile): string {
  return PROFILE_TEXT[profile];
}

/**
 * The header's numbers and legends.
 *
 * @param input - perf's second and status, the bridge payload, the page's engine and the recorder.
 * @param input.second - perf's second.
 * @param input.status - perf's status.
 * @param input.payload - The last `bridge:status`.
 * @param input.hasBridge - Whether the bridge is composed.
 * @param input.engine - The page's engine.
 * @param input.recording - Whether the recorder records.
 * @param input.recordingMs - How long the recorder has recorded, ms.
 * @param input.idleFor - How long the screen has rested ("12s", "" when unknown); undefined while awake.
 * @param input.compact - The compact card.
 * @returns The header view.
 */
export function headerView(input: {
  readonly second: PerfSecond;
  readonly status: PerfStatus;
  readonly payload: LinkPayload | undefined;
  readonly hasBridge: boolean;
  readonly engine: string | undefined;
  readonly recording: boolean;
  readonly recordingMs?: number;
  readonly idleFor?: string | undefined;
  readonly compact?: boolean;
}): HeaderView {
  const on = input.status.state === "on";
  const idle = on && input.idleFor !== undefined;
  let fps = on ? String(input.second.fps.drawn) : "—";
  if (idle) fps = IDLE_WORD;
  return {
    fps,
    fpsUnit: idle ? (input.idleFor ?? "") : FPS_WORD,
    compact: input.compact ?? false,
    recFor: input.recording ? shortDuration(input.recordingMs ?? 0) : "",
    spikes: on ? input.second.spikes : 0,
    link: linkLegend(input.payload, input.hasBridge),
    stale: isStale(input.engine, input.payload),
    rec: input.recording
  };
}

/**
 * The pill's accessible name.
 *
 * @param header - The header view.
 * @returns The label.
 * @example
 * ```ts
 * pillLabel({ fps: "54", fpsUnit: "fps", compact: false, recFor: "", spikes: 6, link: { kind: "none", text: "NO PC", colour: "var(--ink)" }, stale: false, rec: false }); // "54 fps, 6 spikes, 6 s. Open the overlay"
 * ```
 */
export function pillLabel(header: HeaderView): string {
  const fps = header.fpsUnit === "" ? header.fps : `${header.fps} ${header.fpsUnit}`;
  return `${fps}, ${header.spikes} spikes, 6 s. Open the overlay`;
}

/**
 * The engine line: the page's engine and build and the profile text.
 *
 * @param build - `registry.build()`.
 * @param stale - Whether STALE shows.
 * @returns The engine line view.
 * @example
 * ```ts
 * engineLine({ profile: "none" }, false); // { engine: "unknown", build: "—", profile: "no agent flags", stale: false }
 * ```
 */
export function engineLine(build: BuildInfo, stale: boolean): EngineLineView {
  return {
    engine: build.engine ?? "unknown",
    build: build.id ?? "—",
    profile: profileText(build.profile),
    stale
  };
}
