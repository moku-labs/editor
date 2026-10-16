/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { vi } from "vitest";
import type { Json, Manifest, RunResult } from "../../registry/protocol";
import { DEVICE } from "./device-fixtures";
import { createCtx, GAME_01_SOURCES, manifestOf, type TestCtx } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A renderView ctx for Mission control's wiring tests: a manifest that lists the
// Mission control feeds and commands, Render shown, the active source set, and
// a link whose reads and runs the test answers by hand.
// ─────────────────────────────────────────────────────────────────────────────

/** The feeds of Mission control (spec 09 § M2). */
export const MISSION_SOURCES: readonly string[] = [
  "editor.perf.second",
  "editor.perf.frames",
  "editor.perf.events",
  "editor.perf.passes",
  "editor.perf.detail",
  "editor.recorder"
];

/** The commands Render sends (spec 09 § M0). */
export const MISSION_COMMANDS: readonly string[] = [
  "game.frameRate",
  "editor.perf.sections",
  "game.debug",
  "editor.record"
];

/**
 * A manifest of a game with the scene sources and the given Mission control feeds and commands.
 *
 * @param sources - The Mission control feeds it lists.
 * @param allowed - Whether its build runs the commands.
 * @returns The manifest.
 */
export function missionManifest(
  sources: readonly string[] = MISSION_SOURCES,
  allowed = true
): Manifest {
  const base = manifestOf([...GAME_01_SOURCES, ...sources]);
  return {
    ...base,
    commands: MISSION_COMMANDS.map(id => ({
      id,
      title: id,
      input: {},
      effect: "cosmetic" as const,
      ...(allowed ? {} : { allowed: false as const })
    }))
  };
}

/** One read or run the link was asked for, answered by the test. */
export type PendingCall = {
  readonly id: string;
  readonly input: Json | undefined;
  resolve(value: Json): void;
  reject(error: unknown): void;
};

/** A ctx whose link reads and runs wait for the test. */
export type MissionCtx = TestCtx & {
  /** Reads of Mission control's feeds, in order. */
  readonly reads: PendingCall[];
  /** Runs of commands, in order. */
  readonly runs: PendingCall[];
};

/**
 * A ctx for Mission control: the manifest lists its feeds and commands, Render is shown, the active
 * source is the local preview (or the demo phone), the link's reads of `editor.*` and its runs wait
 * for the test (other reads answer null).
 *
 * @param options - The source and the feeds.
 * @param options.device - The active source is the demo phone.
 * @param options.sources - The feeds the manifest lists.
 * @param options.allowed - The build runs the commands.
 * @returns The ctx.
 */
export function missionCtx(
  options: { device?: boolean; sources?: readonly string[]; allowed?: boolean } = {}
): MissionCtx {
  const ctx = createCtx();
  const reads: PendingCall[] = [];
  const runs: PendingCall[] = [];
  ctx.link.manifestValue = missionManifest(options.sources, options.allowed ?? true);
  ctx.link.api.read = vi.fn((id: string, input?: Json) => {
    if (!id.startsWith("editor.")) return Promise.resolve<Json>(null);
    return new Promise<Json>((resolve, reject) => reads.push({ id, input, resolve, reject }));
  });
  vi.mocked(ctx.link.api.run).mockImplementation(
    (id: string, input?: Json) =>
      new Promise<RunResult>((resolve, reject) =>
        runs.push({
          id,
          input,
          resolve: value => resolve({ value, state: { path: "home", frame: 1, tainted: false } }),
          reject
        })
      )
  );
  if (options.device === true) {
    ctx.activeSource.current = { kind: "device", session: "s-9", device: DEVICE };
    ctx.activeSource.label = {
      name: "Galaxy A26",
      model: "SM-A266B",
      kind: "device",
      link: { kind: "wire", transport: "adb", address: "127.0.0.1" }
    };
  }
  ctx.state.mission.source = ctx.activeSource.current;
  ctx.state.active = true;
  return Object.assign(ctx, { reads, runs });
}

/**
 * Lets pending promise callbacks run.
 */
export async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}
