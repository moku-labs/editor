/**
 * @file stateView plugin — the "Last commit" card: one row per derived patch with its op tag,
 * pointer and value change, "+N more patches", "rng advanced", or why there is no commit.
 */
import type { VNode } from "preact";
import { compactJson } from "../tree";
import type { LastCommit, StatePatch, StateViewApi, TrackerNote } from "../types";

/**
 * Props of `PatchList`.
 */
export type PatchListProps = {
  readonly api: StateViewApi;
  readonly commit: LastCommit | undefined;
};

/**
 * The shared tag of each op: add = live soft, replace = accent soft, remove = error soft.
 */
const OP_TAG: { readonly [Op in StatePatch["op"]]: "ok" | "acc" | "err" } = {
  add: "ok",
  replace: "acc",
  remove: "err"
};

/**
 * The empty-body line of each note; "none" shows nothing (the workspace empty card covers it).
 */
const EMPTY_TEXT: { readonly [Note in TrackerNote]: string } = {
  none: "",
  waiting: "No commit seen yet · patches appear after the next commit",
  reloaded: "Game page reloaded · waiting for the next commit"
};

/**
 * The value change of one patch: struck old value → new value, the new value, or the struck
 * old value. Each text is cut at 120 chars; the full value is in `title`.
 *
 * @param props - The patch.
 * @param props.patch - The patch.
 * @returns The change line.
 * @example
 * ```tsx
 * <Change patch={{ op: "replace", root: "player", path: ["energy"], pointer: "/player/energy", value: 7, was: 8 }} />
 * ```
 */
function Change(props: { readonly patch: StatePatch }): VNode {
  const { op, value, was } = props.patch;
  const old = <s title={compactJson(was, Number.POSITIVE_INFINITY)}>{compactJson(was)}</s>;
  const next = (
    <span data-part="value" title={compactJson(value, Number.POSITIVE_INFINITY)}>
      {compactJson(value)}
    </span>
  );
  return (
    <span data-part="change">
      {op === "add" ? undefined : old}
      {op === "replace" ? " → " : undefined}
      {op === "remove" ? undefined : next}
    </span>
  );
}

/**
 * The "Last commit" card.
 *
 * @param props - The api and the last commit.
 * @returns The card.
 * @example
 * ```tsx
 * <PatchList api={api} commit={api.lastCommit()} />
 * ```
 */
export function PatchList(props: PatchListProps): VNode {
  const { api, commit } = props;
  if (commit === undefined) {
    return (
      <section data-card="" data-part="patch-list" aria-label="Last commit">
        <header data-part="head">
          <h3>Last commit</h3>
        </header>
        <p data-part="empty">{EMPTY_TEXT[api.note()]}</p>
      </section>
    );
  }

  const total = commit.patches.length + commit.truncated;
  return (
    <section data-card="" data-part="patch-list" aria-label="Last commit">
      <header data-part="head">
        <h3>Last commit</h3>
        {commit.frame === undefined ? undefined : (
          <span data-part="frame">{`~f${commit.frame}`}</span>
        )}
        <span data-tag="acc" data-part="count">
          {total === 1 ? "1 patch" : `${total} patches`}
        </span>
      </header>
      <ol data-part="patches">
        {commit.patches.map(patch => (
          <li key={patch.pointer} data-op={patch.op}>
            <span data-tag={OP_TAG[patch.op]}>{patch.op}</span>
            <code data-part="pointer">{patch.pointer}</code>
            <Change patch={patch} />
          </li>
        ))}
      </ol>
      {commit.truncated > 0 ? (
        <p data-part="more">{`+${commit.truncated} more patches`}</p>
      ) : undefined}
      {commit.rngChanged ? <p data-part="meta">rng advanced</p> : undefined}
    </section>
  );
}
