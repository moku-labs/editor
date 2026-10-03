/**
 * @file stateView plugin — the State workspace (A4): the title, then three columns: the Player
 * tree, the Last commit patches with the Session tree below, and the Runner card.
 */
import type { VNode } from "preact";
import type { Json, LinkStatus } from "../../registry/protocol";
import { frameOf, isModelSnapshot } from "../model";
import type { Config, LastCommit, StateViewApi } from "../types";
import { JsonTree } from "./JsonTree";
import { PatchList } from "./PatchList";
import { RunnerCard } from "./RunnerCard";
import { useTracker } from "./useTracker";

/**
 * Why the commit frame carries a `~`.
 */
export const COMMIT_FRAME_HINT =
  "Frame of the heartbeat when the commit arrived. The engine does not report the commit frame yet.";

/**
 * Props of `StateView`.
 */
export type StateViewProps = {
  readonly api: StateViewApi;
  readonly config: Readonly<Config>;
  /** The panel's game.model value. */
  readonly model: Json;
  /** The panel's game.position value. */
  readonly position: Json;
  /** The panel's game.history {last: 1} value. */
  readonly history: Json;
  /** The link status of this render. */
  readonly status: LinkStatus;
};

/**
 * The title line: frame of the status, and the approximate commit frame when a commit exists.
 *
 * @param props - The status frame and the last commit.
 * @param props.frame - The frame of the link status.
 * @param props.last - The last commit.
 * @returns The title.
 * @example
 * ```tsx
 * <Title frame={1840} last={last} /> // "State · player and session at frame 1840 · last commit ~f1503"
 * ```
 */
function Title(props: {
  readonly frame: number | undefined;
  readonly last: LastCommit | undefined;
}): VNode {
  const { frame, last } = props;
  const at = frame === undefined ? "" : ` at frame ${frame}`;
  return (
    <h2 data-part="title">
      {`State · player and session${at}`}
      {last === undefined ? undefined : " · last commit"}
      {last?.frame === undefined ? undefined : (
        <>
          {" "}
          <abbr title={COMMIT_FRAME_HINT}>{`~f${last.frame}`}</abbr>
        </>
      )}
    </h2>
  );
}

/**
 * The State workspace.
 *
 * @param props - The api, the config, the panel values and the link status.
 * @returns The workspace.
 */
export function StateView(props: StateViewProps): VNode {
  const { api, config, model, position, history, status } = props;
  const last = useTracker(api);
  const snapshot = isModelSnapshot(model) ? model : undefined;

  return (
    <div data-part="state-view">
      <Title frame={frameOf(status)} last={last} />
      <div data-part="columns">
        <section data-card="" data-part="player-card" aria-label="Player">
          <header data-part="head">
            <h3>Player</h3>
            <button
              type="button"
              data-variant="ghost"
              data-size="sm"
              data-part="expand-all"
              onClick={() => api.expandAll("player", true)}
            >
              Expand all
            </button>
            <button
              type="button"
              data-variant="ghost"
              data-size="sm"
              data-part="collapse-all"
              onClick={() => api.expandAll("player", false)}
            >
              Collapse all
            </button>
          </header>
          {snapshot === undefined ? undefined : (
            <JsonTree
              api={api}
              pageSize={config.pageSize}
              value={snapshot.player}
              root="player"
              commit={last}
            />
          )}
        </section>
        <div data-part="commit-column">
          <PatchList api={api} commit={last} />
          <section data-card="" data-part="session-card" aria-label="Session">
            <header data-part="head">
              <h3>Session</h3>
              <span data-tag="mut">not saved</span>
            </header>
            {snapshot === undefined ? undefined : (
              <JsonTree
                api={api}
                pageSize={config.pageSize}
                value={snapshot.session}
                root="session"
                commit={last}
              />
            )}
          </section>
        </div>
        <RunnerCard api={api} position={position} history={history} status={status} />
      </div>
    </div>
  );
}
