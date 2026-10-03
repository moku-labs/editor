/**
 * @file Shared view module — the one barrel of scene/: build, fits, calibrate, hit, textures, types.
 */
export { buildScene, refId } from "./build";
export { calibrationFrom, calibrationTarget, toPage } from "./calibrate";
export { drawnRect } from "./fits";
export { ancestorsOf, clientFromPage, elementAt, pageFromClient } from "./hit";
export { parseTextureManifest } from "./textures";
export type {
  Calibration,
  ElementRef,
  FrameBoxLike,
  PageRect,
  SceneError,
  SceneInput,
  SceneNode,
  SceneSnapshot,
  TextureCatalogue,
  TextureInfo
} from "./types";
