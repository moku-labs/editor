/**
 * @file overlay plugin — registers the bundled faces with `document.fonts` at the first change to a
 * visible mode (the bytes travel inside the module: a shadow root ignores `@font-face`, and a game
 * page has no stylesheet asset of the editor). When the loads settle, the graph's legends are
 * measured again and the next tick repaints. onStop deletes them.
 */
import type { FaceSource, OverlayCtx, OverlayState } from "../types";
import { FACES } from "./faces";

/** The faces each state added, with the set they were added to. */
const registered = new WeakMap<
  OverlayState,
  { readonly set: FontFaceSet; readonly faces: FontFace[] }
>();

/**
 * The woff2 bytes of a base64 text.
 *
 * @param base64 - The text.
 * @returns The bytes.
 * @example
 * ```ts
 * bytesOf("d09GMg=="); // Uint8Array [119, 79, 70, 50]: "wOF2"
 * ```
 */
export function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.codePointAt(index) ?? 0;
  return bytes;
}

/**
 * Registers the faces once (the first visible mode). Without `FontFace` or `document.fonts` (a test
 * runtime) it registers nothing and logs debug `overlay:fonts-unavailable`.
 *
 * @param octx - Domain context.
 * @param faces - The faces; the bundled table by default.
 */
export function registerFaces(octx: OverlayCtx, faces: readonly FaceSource[] = FACES): void {
  const { state } = octx;
  if (state.faces !== undefined) return;

  const set = state.host?.ownerDocument.fonts;
  if (typeof FontFace !== "function" || set === undefined) {
    state.faces = [];
    octx.log.debug("overlay:fonts-unavailable");
    return;
  }
  const made = faces.map(
    source =>
      new FontFace(source.family, bytesOf(source.base64), {
        weight: String(source.weight),
        style: "normal",
        display: "swap"
      })
  );
  for (const face of made) set.add(face);
  state.faces = made;
  registered.set(state, { set, faces: made });
  Promise.allSettled(made.map(face => face.load())).then(() => {
    if (state.graph !== undefined) octx.graph.resetText(state.graph);
    state.painted.version = -1;
  });
}

/**
 * Deletes the faces this state registered.
 *
 * @param state - Overlay state.
 */
export function deleteFaces(state: OverlayState): void {
  const entry = registered.get(state);
  registered.delete(state);
  state.faces = undefined;
  if (entry === undefined) return;
  for (const face of entry.faces) entry.set.delete(face);
}
