/**
 * @file workspace plugin — B1, the top bar, left to right: logo, game name, session chip, link
 * pill, Pause/Resume, Step 1 frame (only while paused), the palette search box, the Game switch
 * (preview of the current workspace), the Overlay in game switch, Reference mode, Registry
 * counts, theme toggle. Controls that cannot act now are `aria-disabled` so their tooltip still
 * explains why. Below 560 px the bar keeps the controls and drops the game name, the session chip,
 * the search text and the counts (TopBar.css).
 */
import type { ComponentChildren, VNode } from "preact";
import { linkPlugin } from "../../link";
import { closePopover, openPopover, stepOnce, togglePause, togglePreview } from "../actions";
import { formatCombo, isApplePlatform } from "../keys/keymap";
import { overlayAvailable, setOverlayInGame } from "../overlay";
import { openPalette } from "../palette/items";
import { chooseTheme } from "../prefs/apply";
import { effectiveTheme } from "../prefs/theme";
import { toggleReference } from "../reference";
import type { WorkspaceCtx } from "../types";
import { isPreviewWorkspace } from "../workspaces";
import { Icon } from "./icons";
import { LinkPill } from "./LinkPill";
import { RegistryPopover } from "./RegistryPopover";
import { SessionChip } from "./SessionChip";
import { StepPopover } from "./StepPopover";
import { useWorkspace } from "./store";

/**
 * Props of `TopBar`.
 */
export type TopBarProps = { readonly ctx: WorkspaceCtx };

/**
 * Props of a top-bar switch.
 */
type SwitchProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly name: string;
  readonly onToggle: () => void;
};

/**
 * A labelled `role="switch"` button.
 *
 * @param props - Label, state and the toggle action.
 * @returns The switch.
 * @example
 * ```tsx
 * <Switch name="game" label="Game" checked disabled={false} title="Show the game preview (G)" onToggle={toggle} />
 * ```
 */
function Switch(props: SwitchProps): VNode {
  return (
    <button
      type="button"
      role="switch"
      data-switch
      data-action={props.name}
      aria-checked={props.checked}
      aria-disabled={props.disabled}
      title={props.title}
      onClick={() => {
        if (!props.disabled) props.onToggle();
      }}
    >
      <span data-track aria-hidden="true" />
      <span>{props.label}</span>
    </button>
  );
}

/**
 * A ghost button of the top bar.
 *
 * @param props - The action name, tooltip, disabled state, click handler and content.
 * @param props.name - `data-action` value.
 * @param props.title - Tooltip.
 * @param props.disabled - aria-disabled; the click does nothing then.
 * @param props.onClick - The action.
 * @param props.children - Icon and text.
 * @param props.anchor - `data-popover-anchor` value for a popover placed under it.
 * @param props.pressed - `aria-pressed` for a toggle button; omitted for a plain one.
 * @returns The button.
 * @example
 * ```tsx
 * <BarButton name="step" title="Step 1 frame (.)" disabled={false} onClick={step}>Step</BarButton>
 * ```
 */
function BarButton(props: {
  readonly name: string;
  readonly title: string;
  readonly disabled?: boolean;
  readonly anchor?: string;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: ComponentChildren;
}): VNode {
  return (
    <button
      type="button"
      data-variant="ghost"
      data-action={props.name}
      data-popover-anchor={props.anchor}
      aria-disabled={props.disabled === true}
      aria-pressed={props.pressed}
      title={props.title}
      onClick={() => {
        if (props.disabled !== true) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * Splits a manifest game string into its name and its trailing version (design B1: the name in
 * sans 600, the version in muted mono).
 *
 * @param game - The manifest game string, e.g. "merge-game 0.0.0".
 * @returns The name and the version, the version undefined when the string has none.
 * @example
 * ```ts
 * splitGameName("merge-game 0.0.0"); // { name: "merge-game", version: "0.0.0" }
 * ```
 */
function splitGameName(game: string): { name: string; version: string | undefined } {
  const match = /^(.*\S)\s+(v?\d[\w.+-]*)$/.exec(game);
  if (match?.[1] === undefined || match[2] === undefined) return { name: game, version: undefined };
  return { name: match[1], version: match[2] };
}

/**
 * The top bar.
 *
 * @param props - The workspace domain context.
 * @returns The bar.
 */
export function TopBar(props: TopBarProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const manifest = ctx.require(linkPlugin).manifest();
  const apple = isApplePlatform(globalThis.navigator);
  const { kind } = state.link;
  const paused = kind === "paused";
  const running = kind === "live" || paused;
  const { active } = state;
  const previewOn = !isPreviewWorkspace(active) || state.previews[active].visible;
  const overlayReady = overlayAvailable(ctx);
  const nextTheme = effectiveTheme(state.theme) === "dark" ? "light" : "dark";
  const gameName = splitGameName(manifest?.game ?? "No game");
  const counts =
    manifest === undefined ? "– · –" : `${manifest.sources.length} · ${manifest.commands.length}`;

  return (
    <header data-ui="top-bar">
      <span data-logo aria-hidden="true">
        <Icon name="logo" />
      </span>
      <span data-game-name>
        <span data-part="name">{gameName.name}</span>
        {gameName.version !== undefined && (
          <>
            {" "}
            <span data-part="version" data-mono>
              {gameName.version}
            </span>
          </>
        )}
      </span>
      <SessionChip ctx={ctx} />
      <LinkPill ctx={ctx} />
      <BarButton
        name="pause"
        title={paused ? "Resume the game (P)" : "Pause the game (P)"}
        disabled={!running}
        onClick={() => togglePause(ctx, "topbar")}
      >
        <Icon name={paused ? "play" : "pause"} />
        <span>{paused ? "Resume" : "Pause"}</span>
      </BarButton>
      <BarButton
        name="step"
        anchor="step"
        title={paused ? "Step 1 frame (.)" : "Pause the game to step frames (P)"}
        disabled={!paused}
        onClick={() => stepOnce(ctx, "topbar")}
      >
        <Icon name="step" />
        <span>Step 1 frame</span>
      </BarButton>
      <button type="button" data-search onClick={() => openPalette(ctx)}>
        <Icon name="search" />
        <span>Jump to node, file, style, texture…</span>
        <kbd>{formatCombo("mod+k", apple)}</kbd>
      </button>
      <Switch
        name="game"
        label="Game"
        checked={previewOn}
        disabled={active === "game"}
        title={active === "game" ? "The Game workspace always shows the game" : "Game preview (G)"}
        onToggle={() => togglePreview(ctx)}
      />
      <Switch
        name="overlay"
        label="Overlay in game"
        checked={state.overlayInGame}
        disabled={!overlayReady}
        title={overlayReady ? "Overlay in game (O)" : "Connect a game with editor.overlay first"}
        onToggle={() => {
          void setOverlayInGame(ctx, !state.overlayInGame, "topbar");
        }}
      />
      <BarButton
        name="reference"
        title="Reference mode (R) — pick game elements for the chat"
        pressed={state.reference}
        onClick={() => toggleReference(ctx)}
      >
        <Icon name="target" />
        <span data-sr-only>Reference mode</span>
      </BarButton>
      <BarButton
        name="registry"
        anchor="registry"
        title="What the game registered"
        onClick={() => {
          if (state.popover === "registry") closePopover(state, "registry");
          else openPopover(state, "registry");
        }}
      >
        <Icon name="registry" />
        <span>Registry</span>
        <span data-counts data-mono>
          {counts}
        </span>
      </BarButton>
      <BarButton name="theme" title={`Theme: ${nextTheme}`} onClick={() => chooseTheme(ctx)}>
        <Icon name="theme" />
        <span data-sr-only>Theme: {nextTheme}</span>
      </BarButton>
      <StepPopover ctx={ctx} />
      <RegistryPopover ctx={ctx} />
    </header>
  );
}
