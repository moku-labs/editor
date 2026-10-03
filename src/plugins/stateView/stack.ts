/**
 * @file stateView plugin — the runner stack (pure): the stack frames of a runtime path, derived
 * from the flow graph. The game does not expose its stack, so the Runner card derives it.
 */
import type { Json } from "../registry/protocol";
import { field } from "./model";
import type { StackFrame } from "./types";

/**
 * The stack frames of a runtime path: the path is the node names of the frames joined with "/".
 * The first frame is in `graph.main`; each next flow is the `subFlow` of the node before. A slot
 * node has no single sub-flow: below it as the second-last segment, the last frame takes
 * `topFlow` (game.position.flow). Any other unknown step or a missing graph gives [] (the card
 * then shows the raw path).
 *
 * @param path - The runtime path, e.g. "board/awaitIntent".
 * @param graph - game.graph, or undefined.
 * @param topFlow - The flow of the top frame (game.position.flow).
 * @returns The frames, outermost first, or [].
 * @example
 * ```ts
 * stackOf("board/awaitIntent", graph, "board"); // [{ flow: "main", node: "board" }, { flow: "board", node: "awaitIntent" }]
 * ```
 */
export function stackOf(
  path: string,
  graph: Json | undefined,
  topFlow: string | undefined
): readonly StackFrame[] {
  const main = field(graph, "main");
  const flows = field(graph, "flows");
  if (typeof main !== "string" || path === "") return [];

  const segments = path.split("/");
  const frames: StackFrame[] = [];
  let flow = main;
  for (const [index, node] of segments.entries()) {
    const entry = field(field(field(flows, flow), "nodes"), node);
    if (entry === undefined) return [];
    frames.push({ flow, node });
    if (index === segments.length - 1) break;

    const subFlow = field(entry, "subFlow");
    const last = segments[index + 1];
    if (typeof subFlow === "string") {
      flow = subFlow;
    } else if (index === segments.length - 2 && topFlow !== undefined && last !== undefined) {
      frames.push({ flow: topFlow, node: last });
      break;
    } else {
      return [];
    }
  }
  return frames;
}
