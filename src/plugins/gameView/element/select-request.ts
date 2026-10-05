/**
 * @file gameView plugin — the editor-channel request `select` (MCP `moku_select`, U4, D-33) the hub
 * relays to the editor page through link's `handle("select")`. A rect wins over key and ref and
 * picks an area (U9). Else the element is found on a fresh scene by key (the first ui node with
 * it, projection-qualified `"hud/infoBar"` too) or by ref, inspected (Game workspace, Element tab:
 * the user sees it) and, unless `card` is false, picked like a picker click without the clipboard
 * (`copy: false`, A8). The answer is the resulting SelectionInfo. Not found: -32602.
 */
import type { SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { SelectionInfo, SelectParams } from "../../registry/protocol";
import { errorCode, wireError } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { pickArea } from "../reference/area";
import { completePick } from "../reference/pick";
import { readFreshScene } from "../scene/read";
import type { GameViewCtx } from "../types";
import { knownSource, selectionFacts } from "./publish";
import { inspectElement } from "./select";
import { elementByKey, selectionOf } from "./selection";

/**
 * The -32602 refusal of a select.
 *
 * @param field - The params field it is about.
 * @param problem - What is wrong, without the prefix.
 * @param hint - What to do about it.
 * @returns The error, ready to throw.
 */
function refused(field: "key" | "ref", problem: string, hint: string): Error {
  return wireError(errorCode.invalidInput, `${problem}.\n  ${hint}.`, {
    reason: "invalid_input",
    retryable: false,
    field
  });
}

/**
 * The element a select names on the scene: by key, else by ref.
 *
 * @param ctx - Domain context of gameView.
 * @param scene - The fresh scene.
 * @param params - The key or the ref.
 * @returns The node.
 * @throws {Error} -32602 when no element has the key or the ref, when the ref is the empty ui ref
 *   of an empty area, or when the params name neither.
 */
function targetOf(ctx: GameViewCtx, scene: SceneSnapshot, params: SelectParams): SceneNode {
  const { key, ref } = params;
  if (key !== undefined) {
    const node = elementByKey(scene, ctx.state.sources.projections, key);
    if (node !== undefined) return node;
    throw refused("key", `No element with key ${key}`, "Pass the key of a placed ui node");
  }
  if (ref?.kind === "ui" && ref.path === "") {
    throw refused("ref", "area selection has no element", "Select an element, or an area with one");
  }
  if (ref !== undefined) {
    const node = scene.nodes.get(refId(ref));
    if (node !== undefined) return node;
    throw refused("ref", `No element with ref ${refId(ref)}`, "Pass the ref of moku_selection");
  }
  throw refused("key", "editor.select needs a key, a ref or a rect", "Pass one of them");
}

/**
 * Answers the editor-channel request `select`: an area for a rect; else the element by key or
 * ref, inspected and (unless `card` is false) picked without the clipboard.
 *
 * @param ctx - Domain context of gameView.
 * @param params - The checked SelectParams; `card` absent means true.
 * @returns The selection after the select.
 * @throws {Error} The link's WireError when no game answers the scene; -32602 when the element
 *   is not found.
 */
export async function answerSelect(ctx: GameViewCtx, params: SelectParams): Promise<SelectionInfo> {
  const card = params.card ?? true;
  const scene = await readFreshScene(ctx);

  if (params.rect !== undefined) {
    ctx.require(workspacePlugin).show("game");
    return pickArea(ctx, scene, params.rect, { copy: false, card });
  }

  const node = targetOf(ctx, scene, params);
  inspectElement(ctx, node.ref);
  if (!card) return selectionOf(node, selectionFacts(ctx, scene.frame, knownSource(ctx, node)));

  const picked = await completePick(ctx, node, scene, { copy: false });
  return picked.info;
}
