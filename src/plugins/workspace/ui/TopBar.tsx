/**
 * @file workspace plugin — B1, the top bar, in two layouts by window width (round 2 R1).
 *
 * 900 px and wider (`data-layout="wide"`), left to right: the game mark, game name, source pill
 * (W9: the local preview or the device the page reads, and the source menu), session chip, the
 * computer's engine fingerprint (`engine 0.14.13+1ab7f2`, once link knows it; TopBar.css hides it
 * below 1100 px), link pill, Pause/Resume, Step 1 frame, the palette search box, the Preview (G),
 * Overlay (O) and Hot reload (H) switches with visible labels, Registry (icon; counts in its
 * title), theme toggle. TopBar.css gives up room in steps as the window narrows, so the row always
 * fits: under 1360 px Pause and Step show their icons, the game name drops its version and the
 * source pill how the source is reached; under 1140 px the source pill shows its dot only (its
 * title keeps the full label).
 *
 * Below 900 px (`data-layout="compact"`): the game mark, game name, source pill (the name only),
 * link pill (the session id in its title; it opens the session menu), Pause/Resume and Step as
 * icons (the label is their accessible name), the Hot reload (H) icon toggle (round 2b R15), the search icon and the ⋯ menu
 * holding the rest; the toggle stays in the menu too. The game name's title carries the engine
 * fingerprint there. At 560 px and narrower the game name hides (TopBar.css). Controls that cannot act now are `aria-disabled` so their tooltip still explains
 * why.
 *
 * The game mark (U1) is a tile with the initials of the game name, tinted by a hue from the name
 * (`markOf`); without a game it is a neutral dot.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import { Icon, type IconName } from "../../panels/shared/icons";
import { closePopover, openPopover, stepOnce, togglePause } from "../actions";
import { formatCombo, isApplePlatform } from "../keys/keymap";
import { markOf } from "../mark";
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
  registryTitle,
  type ToggleControl
} from "./controls";
import { LinkPill } from "./LinkPill";
import { MoreMenu } from "./MoreMenu";
import { RegistryPopover } from "./RegistryPopover";
import { SessionChip, SessionMenu, sessionsView } from "./SessionChip";
import { SourcePill } from "./SourcePill";
import { StepPopover } from "./StepPopover";
import { useWorkspace } from "./store";
import { heldNames } from "./text";

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
 * The icon toggles the compact bar shows before the search (R15): Hot reload at every compact
 * width, none in the wide bar (it has its own switches).
 *
 * @param width - The window width in CSS px.
 * @returns The data-action names, in bar order.
 * @example
 * ```ts
 * barToggles(720); // ["hot-reload"]
 * barToggles(480); // ["hot-reload"]
 * barToggles(960); // []
 * ```
 */
export function barToggles(width: number): readonly "hot-reload"[] {
  return barLayout(width) === "wide" ? [] : ["hot-reload"];
}

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
 * The game mark (U1): a tile with the initials of the game, tinted by the hue of its name. The
 * version is left out, so a new version keeps the colour. The hue goes out as the inline custom
 * property `--mark-hue`, the only inline style; without a game there is none and TopBar.css keeps
 * the tile neutral.
 *
 * @param props - The manifest game string.
 * @param props.game - E.g. "merge-game 0.0.0"; undefined without a game.
 * @returns The tile.
 */
function MarkTile(props: { readonly game: string | undefined }): VNode {
  const { game } = props;
  const mark = markOf(game === undefined ? undefined : splitGameName(game).name);
  return (
    <span
      data-mark
      aria-hidden="true"
      style={mark.hue === undefined ? undefined : { "--mark-hue": String(mark.hue) }}
    >
      {mark.text}
    </span>
  );
}

/**
 * The game name and its version; in the compact bar its title also names the computer's engine
 * fingerprint.
 *
 * @param props - The manifest game string and the title.
 * @param props.game - E.g. "merge-game 0.0.0", "No game" without one.
 * @param props.title - The tooltip, e.g. "merge-game 0.0.0 · engine 0.14.13+1ab7f2"; none when undefined.
 * @returns The name.
 */
function GameName(props: { readonly game: string; readonly title: string | undefined }): VNode {
  const { name, version } = splitGameName(props.game);
  return (
    <span data-game-name title={props.title}>
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
  const placeholder = "Jump to node, file, texture";
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
 * The text of a ghost button: visible in the wide bar, only the accessible name in the compact
 * one, where the button shows its icon.
 *
 * @param props - The text and the layout.
 * @param props.text - The label.
 * @param props.compact - Whether the bar is compact.
 * @returns The label span.
 */
function ButtonLabel(props: { readonly text: string; readonly compact: boolean }): VNode {
  return props.compact ? <span data-sr-only>{props.text}</span> : <span>{props.text}</span>;
}

/**
 * A toggle as an icon button of the compact bar (R15): `aria-pressed` carries its state and a dot
 * marks it while on, the label is its accessible name, the title names its key and, when it
 * cannot act, why.
 *
 * @param props - The control and its icon.
 * @param props.control - What the button shows and does.
 * @param props.icon - The icon.
 * @returns The button.
 */
function IconToggle(props: { readonly control: ToggleControl; readonly icon: IconName }): VNode {
  const { control } = props;
  return (
    <BarButton
      name={control.name}
      title={control.title}
      pressed={control.checked}
      disabled={control.disabled}
      onClick={control.toggle}
    >
      <Icon name={props.icon} />
      {control.checked && <span data-part="dot" aria-hidden="true" />}
      <span data-sr-only>{control.label}</span>
    </BarButton>
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
 * The right part of the wide bar: the three switches, Registry, theme.
 *
 * @param props - The workspace domain context.
 * @param props.ctx - Domain context of workspace.
 * @returns The controls.
 */
function WideControls(props: { readonly ctx: WorkspaceCtx }): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const manifest = ctx.require(linkPlugin).manifest();
  const nextTheme = effectiveTheme(state.theme) === "dark" ? "light" : "dark";

  return (
    <>
      <ControlSwitch control={previewControl(ctx)} />
      <ControlSwitch control={overlayControl(ctx)} />
      <ControlSwitch control={hotReloadControl(ctx)} />
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
  const link = ctx.require(linkPlugin);
  const manifest = link.manifest();
  const engine = link.engine();
  const width = viewportWidth();
  const layout = barLayout(width);
  const compact = layout === "compact";
  const { kind } = state.link;
  const paused = kind === "paused";
  const running = kind === "live" || paused;
  // While the link reloads the bar keeps the last name (U9: nothing moves sideways); the mark
  // holds the same name.
  const game = manifest?.game ?? heldNames(state.link, state.shown).game;

  return (
    <header data-ui="top-bar" data-layout={layout}>
      <MarkTile game={game} />
      <GameName
        game={game ?? "No game"}
        title={
          compact && engine !== undefined ? `${game ?? "No game"} · engine ${engine}` : undefined
        }
      />
      <SourcePill ctx={ctx} />
      {!compact && <SessionChip ctx={ctx} />}
      {!compact && engine !== undefined && (
        <span data-part="engine" data-mono>
          engine {engine}
        </span>
      )}
      <LinkPill ctx={ctx} session={compact} />
      <BarButton
        name="pause"
        title={paused ? "Resume the game (P)" : "Pause the game (P)"}
        disabled={!running}
        onClick={() => togglePause(ctx, "topbar")}
      >
        <Icon name={paused ? "play" : "pause"} />
        <ButtonLabel text={paused ? "Resume" : "Pause"} compact={compact} />
      </BarButton>
      <BarButton
        name="step"
        anchor="step"
        title={paused ? "Step 1 frame (.)" : "Pause the game to step frames (P)"}
        disabled={!paused}
        onClick={() => stepOnce(ctx, "topbar")}
      >
        <Icon name="step" />
        <ButtonLabel text="Step 1 frame" compact={compact} />
      </BarButton>
      {barToggles(width).includes("hot-reload") && (
        <IconToggle control={hotReloadControl(ctx)} icon="flame" />
      )}
      <SearchButton ctx={ctx} compact={compact} />
      {compact ? <MoreMenu ctx={ctx} /> : <WideControls ctx={ctx} />}
      {compact && sessionsView(ctx).many && <SessionMenu ctx={ctx} />}
      <StepPopover ctx={ctx} />
      <RegistryPopover ctx={ctx} anchor={compact ? "more" : "registry"} />
    </header>
  );
}
