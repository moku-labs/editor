/**
 * @file bridge plugin — the checkpoint across Bun's full reload (R6, D-23). Right before Bun
 * reloads the page, `game.bookmark` runs through the registry entry (its door runs at once, not a
 * microtask later as through `channel.run`) and the bookmark goes into sessionStorage with the
 * frame and the pause flag. The bridge of the next document takes it, restores it with
 * `game.restore`, pauses again when it was paused, and sends `restored` in its first hello.
 *
 * Bun runs the new code in the old page before it reloads it, so a checkpoint is only taken by a
 * document other than the one that stored it; one older than CHECKPOINT_MAX_AGE_MS is dropped.
 */
import type { Json, Manifest } from "../../registry/protocol";
import { messageOf } from "../dispatch/send";
import type { BridgeDeps, CheckpointStorage, TakenCheckpoint } from "../types";

/**
 * The sessionStorage key of the checkpoint.
 */
export const CHECKPOINT_KEY = "moku-editor:checkpoint";

/**
 * A checkpoint older than this is dropped: the reload it was taken for never came.
 */
export const CHECKPOINT_MAX_AGE_MS = 30_000;

/**
 * The version of the stored checkpoint shape.
 */
const VERSION = 1;

/**
 * The raw input of a command without input.
 */
// eslint-disable-next-line unicorn/no-null -- null is the wire value for "no input" (contracts §2)
const NO_INPUT: Json = null;

/**
 * What the checkpoint needs: the registry entries and clock, the reload seam, the state, the log.
 */
type CheckpointDeps = Pick<BridgeDeps, "registry" | "reload" | "state" | "log">;

/**
 * The stored checkpoint, as JSON in sessionStorage.
 */
type StoredCheckpoint = TakenCheckpoint & {
  readonly v: typeof VERSION;
  /** `performance.timeOrigin` of the document that stored it. */
  readonly doc: number;
  /** Epoch ms of the store. */
  readonly at: number;
};

/**
 * Writes the checkpoint; a refused write is logged.
 *
 * @param deps - The log.
 * @param storage - sessionStorage.
 * @param checkpoint - What to store.
 */
function store(
  deps: Pick<CheckpointDeps, "log">,
  storage: CheckpointStorage,
  checkpoint: StoredCheckpoint
): void {
  try {
    storage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch (error) {
    deps.log.warn("bridge:checkpoint-failed", { message: messageOf(error) });
  }
}

/**
 * Takes the checkpoint now: the clock is read and `game.bookmark` runs through its registry
 * entry at once; the bookmark is stored when the run settles (microtasks, before the reload). No
 * storage or no `game.bookmark` stores nothing; a failure is logged.
 *
 * @param deps - Registry, reload seam and log.
 */
export function takeCheckpoint(deps: CheckpointDeps): void {
  const { storage, doc } = deps.reload;
  const bookmark = deps.registry.command("game.bookmark");
  if (storage === undefined || bookmark === undefined) return;

  let clock: { readonly frame: number; readonly paused: boolean };
  try {
    clock = deps.registry.clock();
  } catch (error) {
    deps.log.warn("bridge:checkpoint-failed", { message: messageOf(error) });
    return;
  }

  const at = Date.now();
  bookmark.run(NO_INPUT).then(
    ran => {
      store(deps, storage, { v: VERSION, doc, at, ...clock, bookmark: ran.value });
    },
    (error: unknown) => {
      deps.log.warn("bridge:checkpoint-failed", { message: messageOf(error) });
    }
  );
}

/**
 * Takes a checkpoint on every `bun:beforeFullReload`.
 *
 * @param deps - Registry, reload seam and log.
 * @returns The remover.
 */
export function watchReload(deps: CheckpointDeps): () => void {
  return deps.reload.onBeforeFullReload(() => {
    takeCheckpoint(deps);
  });
}

/**
 * Reads a stored checkpoint text: version 1, finite doc, at and frame, a boolean pause flag and a
 * bookmark.
 *
 * @param text - The stored JSON text.
 * @returns The checkpoint, or undefined for any other text.
 * @example
 * ```ts
 * parseCheckpoint('{"v":1,"doc":1,"at":2,"frame":3,"paused":false,"bookmark":{}}')?.frame; // 3
 * ```
 */
function parseCheckpoint(text: string): StoredCheckpoint | undefined {
  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

  const { v, doc, at, frame, paused, bookmark } = parsed;
  const isShape =
    v === VERSION &&
    typeof doc === "number" &&
    typeof at === "number" &&
    typeof frame === "number" &&
    Number.isFinite(frame) &&
    typeof paused === "boolean" &&
    bookmark !== undefined;
  return isShape ? { v: VERSION, doc, at, frame, paused, bookmark } : undefined;
}

/**
 * Takes the checkpoint another document stored: removes it and answers it. A checkpoint of this
 * document stays (the old page is still running); a malformed or stale one is removed.
 *
 * @param deps - Reload seam.
 * @returns The checkpoint to restore, or undefined.
 */
export function takeStoredCheckpoint(
  deps: Pick<CheckpointDeps, "reload">
): TakenCheckpoint | undefined {
  const { storage, doc } = deps.reload;
  const text = storage?.getItem(CHECKPOINT_KEY);
  if (storage === undefined || text === null || text === undefined) return undefined;

  const checkpoint = parseCheckpoint(text);
  if (checkpoint?.doc === doc) return undefined;

  storage.removeItem(CHECKPOINT_KEY);
  if (checkpoint === undefined || Date.now() - checkpoint.at > CHECKPOINT_MAX_AGE_MS) {
    return undefined;
  }
  return { frame: checkpoint.frame, paused: checkpoint.paused, bookmark: checkpoint.bookmark };
}

/**
 * Pauses the game again after a restore; a failure is logged and the restore still counts.
 *
 * @param deps - Registry and log.
 */
async function pauseAgain(deps: CheckpointDeps): Promise<void> {
  const pause = deps.registry.command("game.pause");
  if (pause === undefined) return;
  try {
    await pause.run(NO_INPUT);
  } catch (error) {
    deps.log.warn("bridge:pause-failed", { message: messageOf(error) });
  }
}

/**
 * Restores a checkpoint with `game.restore`, pauses again when it was paused, and keeps
 * `restored` for the next hello. Never rejects: a failure is logged and nothing is kept, so
 * workspace's own restore (D-07) still runs.
 *
 * @param deps - Registry, state and log.
 * @param checkpoint - The checkpoint another document stored.
 * @returns Resolves when done.
 */
export async function restoreCheckpoint(
  deps: CheckpointDeps,
  checkpoint: TakenCheckpoint
): Promise<void> {
  const restore = deps.registry.command("game.restore");
  if (restore === undefined) {
    deps.log.warn("bridge:restore-failed", { message: "the game has no game.restore" });
    return;
  }
  try {
    await restore.run({ bookmark: checkpoint.bookmark });
  } catch (error) {
    deps.log.warn("bridge:restore-failed", { message: messageOf(error) });
    return;
  }

  if (checkpoint.paused) await pauseAgain(deps);
  deps.state.restored = { bookmark: JSON.stringify(checkpoint.bookmark), frame: checkpoint.frame };
  deps.log.info("bridge:restored", { frame: checkpoint.frame });
}

/**
 * The manifest of a hello: the registry's, with `restored` once after a restore.
 *
 * @param deps - Registry and state.
 * @returns The manifest to send.
 */
export function helloManifest(deps: Pick<CheckpointDeps, "registry" | "state">): Manifest {
  const manifest = deps.registry.manifest();
  const { restored } = deps.state;
  if (restored === undefined) return manifest;

  deps.state.restored = undefined;
  return { ...manifest, restored };
}
