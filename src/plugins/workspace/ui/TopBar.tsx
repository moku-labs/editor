/**
 * @file workspace plugin — B1, the top bar, in two layouts by window width (round 2 R1).
 *
 * 900 px and wider (`data-layout="wide"`), left to right: logo, game name, session chip, link
 * pill, Pause/Resume, Step 1 frame, the palette search box, the Preview (G), Overlay (O) and Hot
 * reload (H) switches with visible labels, Reference mode, Registry (icon; counts in its title),
 * theme toggle.
 *
 * Below 900 px (`data-layout="compact"`): logo, game name, link pill (the session id in its title;
 * it opens the session menu), Pause/Resume, Step, the search icon and the ⋯ menu holding the rest.
 * Under 560 px the game name hides too (TopBar.css). Controls that cannot act now are
 * `aria-disabled` so their tooltip still explains why.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import { closePopover, openPopover, stepOnce, togglePause } from "../actions";
import { formatCombo, isApplePlatform } from "../keys/keymap";
import { openPalette } from "../palette/items";
import { chooseTheme } from "../prefs/apply";
import { viewportWidth } from "../prefs/density";
import { effectiveTheme } from "../prefs/theme";
import type { WorkspaceCtx } from "../types";
import { BarButton, Switch } from "./BarControls";
import {
  hotReloadControl,
  overlayControl,
  previewControl,
  referenceControl,
  registryTitle,
  type ToggleControl
} from "./controls";
import { Icon } from "./icons";
import { LinkPill } from "./LinkPill";
import { MoreMenu } from "./MoreMenu";
import { RegistryPopover } from "./RegistryPopover";
import { SessionChip, SessionMenu, sessionsView } from "./SessionChip";
import { StepPopover } from "./StepPopover";
import { useWorkspace } from "./store";

/**
 * Props of `TopBar`.
 */
export type TopBarProps = { readonly ctx: WorkspaceCtx };

/**
 * Below this window width the top bar is compact, in px.
 *
 * @example
 * ```ts
 * barLayout(COMPACT_BAR_BELOW - 1); // "compact"
 * ```
 */
export const COMPACT_BAR_BELOW = 900;

/**
 * The top-bar layout of a window width.
 *
 * @param width - The window width in CSS px.
 * @returns compact below 900 px, wide from there.
 * @example
 * ```ts
 * barLayout(720); // "compact"
 * barLayout(960); // "wide"
 * ```
 */
export function barLayout(width: number): "compact" | "wide" {
  return width < COMPACT_BAR_BELOW ? "compact" : "wide";
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
 * The game name and its version.
 *
 * @param props - The manifest game string.
 * @param props.game - E.g. "merge-game 0.0.0", "No game" without one.
 * @returns The name.
 */
function GameName(props: { readonly game: string }): VNode {
  const { name, version } = splitGameName(props.game);
  return (
    <span data-game-name>
      <span data-part="name">{name}</span>
      {version !== undefined && (
        <>
          {" "}
          <span data-part="version" data-mono>
            {version}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The palette search: a box with its placeholder and ⌘K in the wide bar, an icon button in the
 * compact one. It never shrinks under its content.
 *
 * @param props - The workspace domain context and the layout.
 * @param props.ctx - Domain context of workspace.
 * @param props.compact - Whether the bar is compact.
 * @returns The button.
 */
function SearchButton(props: { readonly ctx: WorkspaceCtx; readonly compact: boolean }): VNode {
  const combo = formatCombo("mod+k", isApplePlatform(globalThis.navigator));
  const placeholder = "Jump to node, file, style, texture";
  if (props.compact) {
    return (
      <button
        type="button"
        data-search
        aria-label={`${placeholder} (${combo})`}
        title={`${placeholder} (${combo})`}
        onClick={() => openPalette(props.ctx)}
      >
        <Icon name="search" />
      </button>
    );
  }
  return (
    <button type="button" data-search onClick={() => openPalette(props.ctx)}>
      <Icon name="search" />
      <span>{placeholder}…</span>
      <kbd>{combo}</kbd>
    </button>
  );
}

/**
 * A toggle as a labelled switch of the wide bar.
 *
 * @param props - The control.
 * @param props.control - What the switch shows and does.
 * @returns The switch.
 */
function ControlSwitch(props: { readonly control: ToggleControl }): VNode {
  const { control } = props;
  return (
    <Switch
      name={control.name}
      label={control.short}
      checked={control.checked}
      disabled={control.disabled}
      title={control.title}
      onToggle={control.toggle}
    />
  );
}

/**
 * The right part of the wide bar: the three switches, Reference mode, Registry, theme.
 *
 * @param props - The workspace domain context.
 * @param props.ctx - Domain context of workspace.
 * @returns The controls.
 */
function WideControls(props: { readonly ctx: WorkspaceCtx }): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const manifest = ctx.require(linkPlugin).manifest();
  const reference = referenceControl(ctx);
  const nextTheme = effectiveTheme(state.theme) === "dark" ? "light" : "dark";

  return (
    <>
      <ControlSwitch control={previewControl(ctx)} />
      <ControlSwitch control={overlayControl(ctx)} />
      <ControlSwitch control={hotReloadControl(ctx)} />
      <BarButton
        name="reference"
        title={reference.title}
        pressed={reference.checked}
        onClick={reference.toggle}
      >
        <Icon name="target" />
        <span data-sr-only>Reference mode</span>
      </BarButton>
      <BarButton
        name="registry"
        anchor="registry"
        title={registryTitle(manifest)}
        onClick={() => {
          if (state.popover === "registry") closePopover(state, "registry");
          else openPopover(state, "registry");
        }}
      >
        <Icon name="registry" />
        <span data-sr-only>Registry</span>
      </BarButton>
      <BarButton name="theme" title={`Theme: ${nextTheme}`} onClick={() => chooseTheme(ctx)}>
        <Icon name="theme" />
        <span data-sr-only>Theme: {nextTheme}</span>
      </BarButton>
    </>
  );
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
  const layout = barLayout(viewportWidth());
  const compact = layout === "compact";
  const { kind } = state.link;
  const paused = kind === "paused";
  const running = kind === "live" || paused;

  return (
    <header data-ui="top-bar" data-layout={layout}>
      <span data-logo aria-hidden="true">
        <Icon name="logo" />
      </span>
      <GameName game={manifest?.game ?? "No game"} />
      {!compact && <SessionChip ctx={ctx} />}
      <LinkPill ctx={ctx} session={compact} />
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
      <SearchButton ctx={ctx} compact={compact} />
      {compact ? <MoreMenu ctx={ctx} /> : <WideControls ctx={ctx} />}
      {compact && sessionsView(ctx).many && <SessionMenu ctx={ctx} />}
      <StepPopover ctx={ctx} />
      <RegistryPopover ctx={ctx} anchor={compact ? "more" : "registry"} />
    </header>
  );
}
