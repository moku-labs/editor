/**
 * @file Shared view module — scene: element at a point, page ↔ client transforms, ancestors.
 */
import type { FrameBoxLike, SceneNode, SceneSnapshot } from "./types";

/**
 * The last node in paint order that contains the point; a full-device node only wins alone.
 *
 * @param _scene - The scene.
 * @param _point - A point in page px.
 * @param _point.x - Page x.
 * @param _point.y - Page y.
 * @param _device - Device W×H.
 * @param _device.w - Device width.
 * @param _device.h - Device height.
 * @example
 * ```ts
 * elementAt(scene, pageFromClient({ x: event.clientX, y: event.clientY }, box), { w: 393, h: 852 });
 * ```
 */
export function elementAt(
  _scene: SceneSnapshot,
  _point: { readonly x: number; readonly y: number },
  _device: { readonly w: number; readonly h: number }
): SceneNode | undefined {
  throw new Error("not implemented");
}

/**
 * Client px → page px: (client − box origin) / box scale.
 *
 * @param _client - A client point.
 * @param _client.x - Client x.
 * @param _client.y - Client y.
 * @param _box - The frame box.
 * @example
 * ```ts
 * pageFromClient({ x: 300, y: 200 }, box);
 * ```
 */
export function pageFromClient(
  _client: { readonly x: number; readonly y: number },
  _box: FrameBoxLike
): { x: number; y: number } {
  throw new Error("not implemented");
}

/**
 * Page px → client px (the inverse of pageFromClient).
 *
 * @param _page - A page point.
 * @param _page.x - Page x.
 * @param _page.y - Page y.
 * @param _box - The frame box.
 * @example
 * ```ts
 * clientFromPage({ x: 141, y: 402 }, box);
 * ```
 */
export function clientFromPage(
  _page: { readonly x: number; readonly y: number },
  _box: FrameBoxLike
): { x: number; y: number } {
  throw new Error("not implemented");
}

/**
 * The ancestor ids of a node, root first.
 *
 * @param _scene - The scene.
 * @param _id - A node id.
 * @example
 * ```ts
 * ancestorsOf(scene, "ui:column#0/hudRow/coins"); // ["ui:column#0", "ui:column#0/hudRow"]
 * ```
 */
export function ancestorsOf(_scene: SceneSnapshot, _id: string): readonly string[] {
  throw new Error("not implemented");
}
