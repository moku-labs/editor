/**
 * @file stateView plugin — the "Runner" card: path, flow · node, the derived stack, link, taint,
 * the last edge, and the intents the gate waits for. No running/mode rows: no source reports them
 * yet (game follow-up F-S1).
 */
import type { VNode } from "preact";
import type { Json, LinkStatus } from "../../registry/protocol";
import { field } from "../model";
import { stackOf } from "../stack";
import { compactJson } from "../tree";
import type { StateViewApi } from "../types";
import { Card } from "./Card";

/**
 * Props of `RunnerCard`.
 */
export type RunnerCardProps = {
  readonly api: StateViewApi;
  /** game.position. */
  readonly position: Json;
  /** game.history {last: 1}. */
  readonly history: Json;
  readonly status: LinkStatus;
};

/**
 * Shown for a value no source gave.
 */
const NONE = "—";

/**
 * A string field, or undefined.
 *
 * @param value - A JSON value.
 * @param key - The field.
 * @returns The string, or undefined.
 * @example
 * ```ts
 * text({ path: "board/awaitIntent" }, "path"); // "board/awaitIntent"
 * ```
 */
function text(value: Json | undefined, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
}

/**
 * The link row text of a status.
 *
 * @param status - The link status.
 * @returns E.g. "live at frame 1840".
 * @example
 * ```ts
 * linkText({ kind: "paused", frame: 1840 }); // "paused at frame 1840"
 * ```
 */
function linkText(status: LinkStatus): string {
  switch (status.kind) {
    case "live":
    case "paused": {
      return `${status.kind} at frame ${status.frame}`;
    }
    case "silent":
    case "lost": {
      return `${status.kind} at frame ${status.lastFrame}`;
    }
    case "empty": {
      return "no game";
    }
    default: {
      return "connecting";
    }
  }
}

/**
 * The last edge of game.history {last: 1}: "board/merge · rejected" and the compact payload.
 *
 * @param history - The history value.
 * @returns The text, or "—".
 * @example
 * ```ts
 * lastEdge([{ path: "board/merge", outcome: "rejected", payload: { reason: "empty" } }]); // 'board/merge · rejected {"reason":"empty"}'
 * ```
 */
function lastEdge(history: Json): string {
  const entry = Array.isArray(history) ? history.at(-1) : undefined;
  const path = text(entry, "path");
  if (path === undefined) return NONE;
  const payload = field(entry, "payload");
  const edge = `${path} · ${text(entry, "outcome") ?? NONE}`;
  return payload === undefined || payload === null ? edge : `${edge} ${compactJson(payload)}`;
}

/**
 * The taint tag: "tainted" (err), "clean" (mut) or "unknown".
 *
 * @param props - The taint.
 * @param props.tainted - The last known taint.
 * @returns The tag.
 * @example
 * ```tsx
 * <Taint tainted={false} /> // <span data-tag="mut">clean</span>
 * ```
 */
function Taint(props: { readonly tainted: boolean | undefined }): VNode {
  if (props.tainted === undefined) return <>unknown</>;
  return props.tainted ? <span data-tag="err">tainted</span> : <span data-tag="mut">clean</span>;
}

/**
 * The "Runner" card.
 *
 * @param props - The api, position, history and link status.
 * @returns The card.
 */
export function RunnerCard(props: RunnerCardProps): VNode {
  const { api, position, history, status } = props;
  const path = text(position, "path");
  const flow = text(position, "flow");
  const node = text(position, "node");
  const waitingValue = field(position, "waiting");
  const waiting = Array.isArray(waitingValue)
    ? waitingValue.filter(intent => typeof intent === "string")
    : [];
  const frames = path === undefined ? [] : stackOf(path, api.graph(), flow);
  const stack =
    frames.length === 0
      ? (path ?? NONE)
      : frames.map(frame => `${frame.flow}/${frame.node}`).join(" › ");

  return (
    <Card part="runner-card" title="Runner">
      <dl data-props="">
        <dt>path</dt>
        <dd data-part="mono">{path ?? NONE}</dd>
        <dt>flow · node</dt>
        <dd data-part="mono">{`${flow ?? NONE} · ${node ?? NONE}`}</dd>
        <dt>stack</dt>
        <dd data-part="mono">{stack}</dd>
        <dt>link</dt>
        <dd>{linkText(status)}</dd>
        <dt>tainted</dt>
        <dd>
          <Taint tainted={api.tainted()} />
        </dd>
        <dt>last edge</dt>
        <dd data-part="mono">{lastEdge(history)}</dd>
      </dl>
      <p data-part="gate-title">{`Gate waits for ${waiting.length}`}</p>
      <ul data-part="gate">
        {waiting.map(intent => (
          <li key={intent}>
            <span data-tag="">{intent}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
