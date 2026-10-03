/**
 * @file gameView plugin — the Device tab (C8): the device list (name, W×H, safe insets; a click
 * sets the preset in its natural orientation), the overlay-in-game box (workspace's flag, R4),
 * the render chips from one `game.render` read when the tab opens (no poll) and the game's cheat
 * commands.
 */
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { isObject } from "../capture/shot";
import { chooseDevice, toggleOverlay } from "../palette";
import type { GameViewCtx } from "../types";
import { useGameView } from "./useGameView";

/**
 * Props of `DeviceTab`.
 */
export type DeviceTabProps = { readonly ctx: GameViewCtx };

/**
 * The render numbers the overlay box shows.
 */
type RenderChips = { readonly fps: number; readonly frameMs: number; readonly textureMb: number };

/**
 * Reads the chips of a game.render value.
 *
 * @param value - The game.render value.
 * @returns fps, frame ms and texture MB, or undefined for another shape.
 * @example
 * ```ts
 * renderChipsOf({ fps: 60, frameMs: 4.2, textureMb: 12.5 })?.fps; // 60
 * ```
 */
function renderChipsOf(value: Json): RenderChips | undefined {
  if (!isObject(value)) return undefined;
  const { fps, frameMs, textureMb } = value;
  if (typeof fps !== "number" || typeof frameMs !== "number" || typeof textureMb !== "number") {
    return undefined;
  }
  return { fps, frameMs, textureMb };
}

/**
 * One read of game.render; undefined when it cannot be read.
 *
 * @param ctx - Domain context of gameView.
 * @returns The chips.
 * @example
 * ```ts
 * await readRender(ctx); // { fps: 60, frameMs: 4.2, textureMb: 12.5 }
 * ```
 */
async function readRender(ctx: GameViewCtx): Promise<RenderChips | undefined> {
  try {
    return renderChipsOf(await ctx.require(linkPlugin).read("game.render"));
  } catch {
    return undefined;
  }
}

/**
 * The Device tab.
 *
 * @param props - The gameView domain context.
 * @returns The tab.
 * @example
 * ```tsx
 * <DeviceTab ctx={ctx} />
 * ```
 */
export function DeviceTab(props: DeviceTabProps): VNode {
  const { ctx } = props;
  useGameView(ctx.state, () => ctx.state.tab);
  const workspace = ctx.require(workspacePlugin);
  const link = ctx.require(linkPlugin);
  const [render, setRender] = useState<RenderChips | undefined>();
  useEffect(() => {
    let alive = true;
    readRender(ctx).then(chips => {
      if (alive) setRender(chips);
    });
    return () => {
      alive = false;
    };
  }, [ctx]);

  const current = workspace.device().preset.id;
  const overlayOn = workspace.overlayInGame();
  const cheats = (link.manifest()?.commands ?? []).filter(command => command.effect === "cheat");

  return (
    <div data-part="device-tab">
      <ul data-part="devices" aria-label="Devices">
        {workspace.devices().map(device => (
          <li key={device.id}>
            <button
              type="button"
              aria-pressed={device.id === current}
              onClick={() => chooseDevice(ctx, device.id)}
            >
              <span data-part="name">{device.name}</span>
              <span data-part="size">
                {device.w}×{device.h}
              </span>
              <span data-part="safe">
                safe top {device.safeTop} · bottom {device.safeBottom}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <section data-part="overlay-box" aria-label="Overlay in game">
        <header>
          <h4>Overlay in game</h4>
          <span data-tag={overlayOn ? "acc" : "mut"}>{overlayOn ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            data-switch=""
            aria-checked={overlayOn}
            aria-label="Overlay in game"
            onClick={() => toggleOverlay(ctx)}
          >
            <span data-track="" />
          </button>
        </header>
        <p>Only render numbers and the game's cheats. No graph controls. Off by default.</p>
        {render !== undefined && (
          <div data-part="render">
            <span data-chip="">fps {render.fps}</span>
            <span data-chip="">{render.frameMs.toFixed(1)} ms</span>
            <span data-chip="">textures {render.textureMb.toFixed(1)} MB</span>
          </div>
        )}
        {cheats.length > 0 && (
          <ul data-part="cheats" aria-label="Cheats">
            {cheats.map(command => (
              <li key={command.id}>
                <code>{command.id}</code>
                <span>{command.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
