/**
 * @file files plugin — the project index of the root (D-38): opens `@moku-labs/game/project` on
 * start, follows its watch, announces every state with `files:project` and answers `find`. The
 * game types are used here only, as type imports (P4). Index off is an error state (D-48): one
 * `files:project-off` error line, and `find` answers -32008.
 */
import type {
  Anchor,
  ProjectChange as IndexChange,
  ProjectApi,
  ProjectIndex
} from "@moku-labs/game/project";
import type { ProjectFound, ProjectState } from "../registry/protocol";
import { emitLogged } from "./emit";
import { indexOff, invalid } from "./errors";
import { resolveReal } from "./sandbox";
import type { FilesCtx, FilesState } from "./types";

/**
 * The part of `@moku-labs/game/project` files calls.
 *
 * @example
 * ```ts
 * // A test hands openIndex a game whose open fails.
 * const failing: ProjectModule = { openProject: () => Promise.reject(new Error("no typescript")) };
 * ```
 */
export type ProjectModule = {
  openProject(options: { root: string }): Promise<ProjectApi>;
};

/**
 * The on variant of ProjectState.
 */
type ProjectOn = Extract<ProjectState, { state: "on" }>;

/**
 * A type with every field writable, for building a fresh value field by field.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The longest key `find` accepts.
 */
const MAX_KEY_LENGTH = 512;

/**
 * The prefix of the JSX keys, which never ride the published state (D-39).
 */
const JSX_PREFIX = "jsx:";

/**
 * Why the index is off when the installed game has no `@moku-labs/game/project`.
 */
const NO_INDEX = "@moku-labs/game 0.6.0 or newer is needed for the project index";

/**
 * The text fields an answer of `find` may carry.
 */
const ANCHOR_TEXT_FIELDS = ["binding", "key", "component", "stem", "prop"] as const;

/**
 * Loads the game's project index. A separate chunk: a game below 0.6.0 has no such export.
 *
 * @returns The module.
 */
function loadGameProject(): Promise<ProjectModule> {
  return import("@moku-labs/game/project");
}

/**
 * The message of anything thrown.
 *
 * @param error - What was thrown.
 * @returns The message, bare.
 * @example
 * ```ts
 * messageOf(new Error('[game] The project index needs the "typescript" package.'));
 * // '[game] The project index needs the "typescript" package.'
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The paths of some anchors, each once, in their order.
 *
 * @param anchors - Def or use anchors of one key.
 * @returns The paths.
 * @example
 * ```ts
 * pathsOf([{ path: "a.ts" }, { path: "b.ts" }, { path: "a.ts" }]); // ["a.ts", "b.ts"]
 * ```
 */
function pathsOf(anchors: readonly Anchor[]): string[] {
  return [...new Set(anchors.map(anchor => anchor.path))];
}

/**
 * Every key but `jsx:` → its def paths; a conflict keeps every path.
 *
 * @param index - The index.
 * @returns The defs map.
 */
function defsOf(index: ProjectIndex): Record<string, string[]> {
  const entries = Object.entries(index.symbols).filter(([key]) => !key.startsWith(JSX_PREFIX));

  return Object.fromEntries(entries.map(([key, symbol]) => [key, pathsOf(symbol.def)]));
}

/**
 * The keys that have uses → the paths of the uses.
 *
 * @param index - The index.
 * @returns The uses map.
 */
function usesOf(index: ProjectIndex): Record<string, string[]> {
  const entries = Object.entries(index.symbols).flatMap(([key, symbol]) => {
    const uses = symbol.uses ?? [];
    return key.startsWith(JSX_PREFIX) || uses.length === 0 ? [] : [[key, pathsOf(uses)]];
  });

  return Object.fromEntries(entries);
}

/**
 * The files that do not parse → their first parse error, `""` when the index gave none.
 *
 * @param index - The index.
 * @returns The broken map.
 */
function brokenOf(index: ProjectIndex): Record<string, string> {
  const entries = Object.entries(index.files).flatMap(([path, file]) =>
    file.state === "broken" ? [[path, file.error ?? ""]] : []
  );

  return Object.fromEntries(entries);
}

/**
 * The state files publishes for an index: the key maps (no `jsx:` key), the broken files and,
 * after a watch batch, the revision it follows and what it changed. Pure.
 *
 * @param index - The index of the game.
 * @param previous - The revision of the state announced before; absent on the first.
 * @param change - What the watch batch changed; absent on the first.
 * @returns A fresh on state.
 * @example
 * ```ts
 * summarize(project.index);
 * // { state: "on", revision: "8a72…", defs: { "flow:main": ["flows/main.ts"], … }, uses: { … }, broken: {} }
 * ```
 */
export function summarize(
  index: ProjectIndex,
  previous?: string,
  change?: IndexChange
): ProjectState {
  const state: Writable<ProjectOn> = {
    state: "on",
    revision: index.revision,
    defs: defsOf(index),
    uses: usesOf(index),
    broken: brokenOf(index)
  };

  if (previous !== undefined) state.previous = previous;
  if (index.manifest !== undefined) state.manifest = index.manifest;
  if (change !== undefined) {
    state.change = {
      files: [...change.files],
      moved: change.moved.map(({ key, from, to }) => ({ key, from, to })),
      removed: [...change.removed]
    };
  }

  return state;
}

/**
 * Stores a state and announces it with `files:project`. A failing hook is logged as
 * `files:emit-failed`.
 *
 * @param ctx - Domain context of files.
 * @param state - The new state.
 */
function announce(ctx: FilesCtx, state: ProjectState): void {
  ctx.state.projectState = state;
  emitLogged(
    () => ctx.emit("files:project", state),
    error => ctx.log.error("files:emit-failed", { event: "files:project", error: String(error) })
  );
}

/**
 * Turns the index off: announces the off state and logs `files:project-off` once, at error level.
 *
 * @param ctx - Domain context of files.
 * @param reason - Why the index is off.
 */
function turnOff(ctx: FilesCtx, reason: string): void {
  announce(ctx, { state: "off", reason });
  ctx.log.error("files:project-off", { reason });
}

/**
 * Loads the game's module; undefined when the import fails.
 *
 * @param load - The loader.
 * @returns The module, or undefined.
 */
async function loadModule(load: () => Promise<ProjectModule>): Promise<ProjectModule | undefined> {
  try {
    return await load();
  } catch {
    return undefined;
  }
}

/**
 * Loads the game's module and opens the index of the root. Never rejects: a failure turns the
 * index off, and a handle that opens after stop is closed at once.
 *
 * @param ctx - Domain context of files.
 * @param load - The loader of `@moku-labs/game/project`.
 * @returns The open handle, or undefined when the index is off or files stopped.
 */
async function openHandle(
  ctx: FilesCtx,
  load: () => Promise<ProjectModule>
): Promise<ProjectApi | undefined> {
  const { state } = ctx;
  const module = await loadModule(load);
  if (state.stopped) return undefined;
  if (module === undefined) {
    turnOff(ctx, NO_INDEX);
    return undefined;
  }

  try {
    const project = await module.openProject({ root: state.rootReal });
    if (!state.stopped) return project;
    project.close();
  } catch (error) {
    if (!state.stopped) turnOff(ctx, messageOf(error));
  }
  return undefined;
}

/**
 * Starts following an open index: the watch announces each batch with the revision it follows,
 * then the first state is announced and the open is logged.
 *
 * @param ctx - Domain context of files.
 * @param project - The open handle.
 * @param startedAt - When the open started, in `performance.now()` ms.
 * @throws {Error} When the watch cannot start; nothing is stored then.
 */
function follow(ctx: FilesCtx, project: ProjectApi, startedAt: number): void {
  const { state } = ctx;
  state.stopWatch = project.watch((index, change) => {
    const held = state.projectState;
    announce(ctx, summarize(index, held.state === "on" ? held.revision : undefined, change));
  });
  state.project = project;

  const { index } = project;
  announce(ctx, summarize(index));
  ctx.log.info("files:project-on", {
    files: Object.keys(index.files).length,
    keys: Object.keys(index.symbols).length,
    ms: Math.round(performance.now() - startedAt)
  });
}

/**
 * Opens the project index of the root, announces it and follows its watch; started from onStart
 * and not awaited. Never rejects (P9). `files.project: false` is off `"disabled"` without a load.
 *
 * @param ctx - Domain context of files.
 * @param load - The loader of `@moku-labs/game/project`; a test passes a fake.
 */
export async function openIndex(
  ctx: FilesCtx,
  load: () => Promise<ProjectModule> = loadGameProject
): Promise<void> {
  if (!ctx.config.project) {
    turnOff(ctx, "disabled");
    return;
  }

  const startedAt = performance.now();
  const project = await openHandle(ctx, load);
  if (project === undefined) return;

  try {
    follow(ctx, project, startedAt);
  } catch (error) {
    project.close();
    turnOff(ctx, messageOf(error));
  }
}

/**
 * Copies one answer of the index field by field, so nothing the protocol does not name rides
 * the wire.
 *
 * @param found - One answer of the handle.
 * @returns A fresh answer.
 * @example
 * ```ts
 * copyFound({ path: "nodes/home.ts", binding: "home", line: 3, range: [3, 1, 3, 48], hash: "1e1e…" }); // a fresh copy
 * ```
 */
function copyFound(found: ProjectFound): ProjectFound {
  const [startLine, startColumn, endLine, endColumn] = found.range;
  const copy: Writable<ProjectFound> = {
    path: found.path,
    line: found.line,
    range: [startLine, startColumn, endLine, endColumn],
    hash: found.hash
  };

  for (const name of ANCHOR_TEXT_FIELDS) {
    const text = found[name];
    if (text !== undefined) copy[name] = text;
  }
  if (found.kind !== undefined) copy.kind = found.kind;
  if (found.broken === true) copy.broken = true;

  return copy;
}

/**
 * The copy of an answer the sandbox lets files read, or undefined.
 *
 * @param ctx - Domain context of files.
 * @param found - One answer of the handle.
 * @returns The copy, or undefined when its path is refused or gone.
 */
async function readable(ctx: FilesCtx, found: ProjectFound): Promise<ProjectFound | undefined> {
  try {
    await resolveReal(ctx, found.path, "read");
    return copyFound(found);
  } catch {
    return undefined;
  }
}

/**
 * Why the index answers no `find`: the reason of the off state.
 *
 * @param state - The announced state.
 * @returns The reason.
 */
function offReason(state: ProjectState): string {
  return state.state === "off" ? state.reason : "not opened";
}

/**
 * The body of `find`: checks the key, waits for the open, asks the index and keeps the answers
 * the sandbox lets files read.
 *
 * @param ctx - Domain context of files.
 * @param key - A project-index key.
 * @returns The answers, lines read from disk now.
 * @throws {Error} -32602 `invalid_input` (`field: "key"`), -32008 while the index is off.
 */
export async function findKey(ctx: FilesCtx, key: string): Promise<ProjectFound[]> {
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH) {
    throw invalid("key", `find: key must be a string of at most ${MAX_KEY_LENGTH} characters`);
  }

  await ctx.state.opening;
  const { project, projectState } = ctx.state;
  if (project === undefined) throw indexOff(offReason(projectState));

  const answers = await project.find(key);
  const kept = await Promise.all(answers.map(found => readable(ctx, found)));
  return kept.filter(found => found !== undefined);
}

/**
 * Ends the watch and closes the index; the state is off `"stopped"`. Announces nothing: onStop
 * has no emit.
 *
 * @param state - Files state.
 */
export function closeIndex(state: FilesState): void {
  state.stopped = true;
  state.stopWatch?.();
  state.project?.close();
  state.stopWatch = undefined;
  state.project = undefined;
  state.projectState = { state: "off", reason: "stopped" };
}
