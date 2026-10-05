# workspace

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools shell and the one game frame.

The shell of the tools page: top bar (B1) with its ⋯ menu, rail with badges (B2), pinned game
preview (B3), step and registry popovers (D1, D2), link pill note (D7), command palette (E1),
toasts (F1), stale bar (F3) and the connecting and no-game cards (F4). It owns the single game
iframe, the device presets, the per-viewer preferences (theme, density, preview per workspace,
device and fold, Show taps, sound), the key map with the Esc unwinding, the overlay-in-game switch,
Reference mode, the Hot reload switch, the tap ripples and the D-07 reload. It also ships the
shared CSS layer every view uses (`styles/`).

The shell is built narrow first: it runs in a browser pane at a third (480 px) or half (720 px)
of the screen. Below 900 px the top bar is compact: Reference mode and Hot reload stay as icons
and the rest moves into a ⋯ menu. At 560 px and narrower it also hides the game name and keeps
only Reference, and the rail is 44 px of icons. No workspace scrolls the page
sideways.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `defaultWorkspace` | `WorkspaceId` | `"game"` | Workspace shown at start when the URL hash names none. |
| `storageKey` | `string` | `"moku-editor"` | localStorage key of the preferences record. |
| `reloadTimeoutMs` | `number` | `15000` | How long `reload()` waits for the new session. |
| `hotReloadWaitMs` | `number` | `1500` | After a save with Bun hot reload on: how long `gameFrame().reload()` waits for the page Bun reloads, or the game's hot swap, before it reloads the frame itself. |
| `toastMs` | `number` | `2600` | How long one toast stays. Hover or focus pauses it. |

`onInit` throws `[moku-editor] workspace.<field> is invalid.\n  <fix>.` for a bad value. The game
URL comes from the boot JSON (`link.boot()?.gameUrl`, else `"/"`), not from config.

## API

`app.workspace`, and `tools.workspace` in every panel view. Type `WorkspaceApi`.

| Member | Signature | What it does |
|---|---|---|
| `active` | `() => WorkspaceId` | The shown workspace. |
| `show` | `(ws) => void` | Shows a workspace, writes `#<ws>`, emits `workspace:changed` when it changed. |
| `theme` | `() => Theme` | Effective theme: the chosen one, else the OS one. |
| `setTheme` | `(theme?) => void` | Sets the theme, or toggles without an argument. Persists. |
| `density` | `() => Density` | The applied density: `compact` or `comfortable`. |
| `setDensity` | `(value: DensityChoice) => void` | `auto`, `compact` or `comfortable`. Persists, sets `data-density` on `<html>`, emits `workspace:density` when the applied value changes. |
| `preview` | `(ws: PreviewWorkspace) => PreviewState` | Preview of a non-Game workspace: `visible`, `size`, `corner`, plus `width` and `height` in px. |
| `setPreview` | `(ws, patch) => void` | Patches the preview. A visibility change toasts "Game preview hidden in Flow · remembered for this workspace". |
| `device` | `() => DeviceChoice` | `{ preset, orientation, folded }`. `preset` is the screen in use: an unfolded foldable carries its inner screen's `w`, `h` and `radius`. Default `iphone-18-pro`, portrait, folded. |
| `setDevice` | `(patch: { preset?, orientation?, folded? }) => void` | Changes preset, orientation or fold. The frame resizes live: the game sees a window resize, no reload. A new preset starts folded unless the patch sets `folded`. |
| `devices` | `() => readonly DeviceSpec[]` | The twenty-one presets in display order (see Devices). |
| `gameFrame` | `() => GameFrame` | `{ url, reload(opts?), dock(slot, { fit, clip? }), overlay(), box() }`. |
| `palette.add` | `(item \| items) => () => void` | Adds palette items. A known id is replaced. The remover keeps newer items. |
| `palette.open` | `(query?) => void` | Opens the palette. |
| `toast` | `(message, file?) => void` | One-line toast. `file` shows in mono after a middle dot. At most 3. |
| `mount` | `(element) => void` | Renders the shell. The first call creates the frame layer in `document.body`. A later call moves the shell, not the frame layer. |
| `host` | `(ws) => HTMLElement` | The `<section data-workspace-host>` panels renders into. Same element before and after `mount`. |
| `badge` | `(ws, badge \| undefined) => void` | Rail badge, or clears it. |
| `previewZone` | `(ws, element, insets?) => () => void` | Where the preview floats in a workspace. Default: its host, 12 px margin. |
| `keys.bind` | `(binding) => () => void` | Adds a key binding. |
| `keys.escape` | `(layer, close) => () => void` | Adds an Esc closer to a layer. |
| `overlayInGame` | `() => boolean` | The overlay-in-game switch. Always `false` at load. |
| `setOverlayInGame` | `(on) => Promise<void>` | Runs `editor.overlay`, toasts, re-applies on every new session. A failure puts the flag back. |
| `reference` | `() => boolean` | Reference mode. Always `false` at load. Never persisted. |
| `setReference` | `(on) => void` | Turns Reference mode on or off. Emits `workspace:reference` on a change. |
| `hotReload` | `() => HotReload \| undefined` | link's `{ hmr, owner }`: whether Bun reloads the game after a save, and who owns the server. `undefined` until the hub reported it. |
| `setHotReload` | `(on) => Promise<boolean>` | Asks the server through `link.setHotReload`. An accepted switch reloads the game frame with its state once the restarted server serves again (D-32). A refusal or a failed switch toasts how to change it and keeps that hint in the switch tooltip. Never rejects. |
| `muted` | `() => boolean` | The sound flag (R11): `true` while the viewer muted the game. Persisted; `false` for a fresh viewer. |
| `setMuted` | `(on) => void` | Sets and persists the sound flag; `onPrefs` listeners get the new `muted`. The same value again does nothing. gameView sends `game.mute`; workspace never touches the game. |
| `onPrefs` | `(fn) => () => void` | Called after every theme, preview, device or sound change with `{ theme, previews, device, muted }`. |

```ts
workspace.show("flow");
workspace.setDensity("compact");
workspace.density(); // "compact"
workspace.setReference(true); // the game gets no input; gameView draws its proxies
workspace.preview("flow").size; // "S"
workspace.setPreview("render", { visible: false });
workspace.device().preset.w; // 402: the iPhone 18 Pro of a fresh viewer
workspace.setDevice({ orientation: "landscape" });
workspace.setDevice({ preset: "galaxy-z-fold-6", folded: false }); // the inner screen, 707 × 823
workspace.setMuted(true); // persisted; onPrefs listeners get { …, muted: true }
workspace.muted(); // true
workspace.hotReload(); // { hmr: true, owner: "bin" } under the moku-editor bin
await workspace.setHotReload(false); // true: the bin restarts without HMR; the game reloads with its state
await workspace.gameFrame().reload({ restore: true });
const remove = workspace.palette.add({ id: "cmd:capture", group: "Commands", label: "Take a screenshot", run });
workspace.toast("Saved", "src/styles.ts");
workspace.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
workspace.previewZone("flow", canvasEl, () => ({ top: 56, bottom: 56 }));
workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run });
workspace.keys.escape("contextMenu", () => menu.close());
await workspace.setOverlayInGame(true);
const off = workspace.onPrefs(prefs => rerender(prefs));
```

### The top bar

The bar picks its layout from the window width and writes it as `data-layout` on
`[data-ui="top-bar"]`. A window resize re-renders it.

- **900 px and wider (`wide`)**: logo, game name, session chip, link pill, Pause, Step, the search
  box, the switches Preview (G), Overlay (O) and Hot reload (H) with visible labels, Reference
  mode, Registry (icon only; the counts are in its title, "Registry · 12 sources · 30 commands"),
  theme. Under 1180 px Pause and Step show their icons only.
- **Below 900 px (`compact`)**: logo, game name (hidden at 560 px and narrower), link pill, Pause
  and Step as icons (the label is their accessible name, the title says the key), then at the end
  the icon toggles Reference mode (`data-action="reference"`, target icon) and Hot reload
  (`data-action="hot-reload"`, flame icon with a dot while on), a search icon and the ⋯ button
  (`data-action="more"`). Both toggles carry `aria-pressed`; Hot reload is inert with the hint
  in its title when the bin does not own it. At 560 px and narrower only Reference stays; Hot
  reload is a ⋯ row then (`barToggles(width)` in `ui/TopBar.tsx`). The session chip is gone: the
  pill's tooltip names the session ("… · session s-7f3a · connected 22:41:07"), and with more
  than one session the pill opens the session menu.
- **The ⋯ menu** is a top-layer `role="menu"` popover. Rows: Game preview (G), Overlay in game
  (O), Reference mode (R), Hot reload (H), each with its state and key (Reference and Hot reload
  are rows even when the bar shows them as icons); then Registry (counts),
  Density (cycles auto → compact → comfortable) and Theme. A toggle row keeps the menu open;
  Registry opens the registry popover under the ⋯ button. A second ⋯ click, Esc or a press
  outside closes it. ↑/↓ move through the rows; opening it from the keyboard focuses the first
  row. Rows keep the `data-action` names of the wide controls (`game`, `overlay`, `reference`,
  `hot-reload`, `registry`, `theme`) plus `density`. In the compact bar `reference` and
  `hot-reload` name both the bar icon and the menu row: select the icon with
  `[data-ui="top-bar"] > [data-action]`, the row inside `[data-ui="more-menu"]`.

Every control keeps its size; only the game name and the wide search box shrink, and the search
box clips its own content, so no control runs over another.

### Devices

Twenty-one presets from `.planning/build/research-devices.md` and the apple.com specs of
2026-10-04 (round 2b R10), in display order, each with `group` (the `<optgroup>`), `dpr`, safe
insets, the screen corner `radius` and the `frame` gameView draws (R9). Sizes are the full-screen
portrait viewport in CSS px. `DEVICE_GROUPS` names the groups. The presets, the groups and the pure
rules (`presetOf`, `screenOf`, `resolveDevice`) live in the protocol (`registry/protocol/devices.ts`),
shared with gameView; workspace keeps the stored choice (`devices.ts`: `deviceChoiceOf`). A fresh viewer
starts with the iPhone 18 Pro; an unknown stored id falls back to it. The iPhone group lists the
SE 3 and the iPhone 15 first, then the current models; the 15 Pro Max, 16 Pro and 16 Pro Max stay
at its end, so a stored choice keeps working.

| Group | Preset (`id`) | Viewport | DPR | Safe top/bottom | Radius |
|---|---|---|---|---|---|
| iPhone | iPhone SE 3 · small, 2022 (`iphone-se`), home-button frame | 375 × 667 | 2 | 20 / 0 | 0 |
| iPhone | iPhone 15 (`iphone-15`) | 393 × 852 | 3 | 59 / 34 | 55 |
| iPhone | iPhone 17e (`iphone-17e`) — approx, notch | 390 × 844 | 3 | 47 / 34 | 47 |
| iPhone | iPhone Air (`iphone-air`) — approx | 420 × 912 | 3 | 68 / 34 | 62 |
| iPhone | iPhone 18 Pro (`iphone-18-pro`) — approx, default | 402 × 874 | 3 | 62 / 34 | 62 |
| iPhone | iPhone 18 Pro Max (`iphone-18-pro-max`) — approx | 440 × 956 | 3 | 62 / 34 | 62 |
| iPhone | iPhone 15 Pro Max (`iphone-15-pro-max`) | 430 × 932 | 3 | 59 / 34 | 55 |
| iPhone | iPhone 16 Pro (`iphone-16-pro`) | 402 × 874 | 3 | 62 / 34 | 62 |
| iPhone | iPhone 16 Pro Max (`iphone-16-pro-max`) | 440 × 956 | 3 | 62 / 34 | 62 |
| Android | Galaxy S24 (`galaxy-s24`) | 360 × 780 | 3 | 0 / 0 | 40 |
| Android | Galaxy A55 (`galaxy-a55`) | 412 × 892 | 2.625 | 0 / 0 | 35 |
| Android | Redmi Note 13 (`redmi-note-13`) — approx | 393 × 873 | 2.75 | 0 / 0 | 35 |
| Android | Pixel 8 (`pixel-8`) | 412 × 915 | 2.625 | 0 / 0 | 35 |
| Android | Xperia 1 V 21:9 (`xperia-1-v`) | 411 × 960 | 4 | 0 / 0 | 0 |
| Foldable | Galaxy Z Fold 6 (`galaxy-z-fold-6`) — approx | cover 369 × 905, inner 707 × 823 | 2.625 | 0 / 0 | 30 |
| Foldable | Galaxy Z Flip 6 (`galaxy-z-flip-6`) | 412 × 1005 | 2.625 | 0 / 0 | 30 |
| Foldable | Pixel 9 Pro Fold (`pixel-9-pro-fold`) — approx | cover 411 × 923, inner 791 × 820 | 2.625 | 0 / 0 | 30 |
| Foldable | iPhone Duo (`iphone-duo`) — approx | cover 466 × 678, inner 890 × 626 | 3 | 0 / 0 | 40 |
| Tablet | iPad mini 7 (`ipad-mini`) | 744 × 1133 | 2 | 0 / 0 | 18 |
| Tablet | iPad Air 11" (`ipad-air-11`) | 820 × 1180 | 2 | 0 / 0 | 18 |
| Desktop | Desktop (`desktop`) | 1440 × 900 | 1 | 0 / 0 | 0 |

- **approx** (`approx: true`): the size or the safe insets are estimates, not published figures
  (low confidence). The iPhone Duo's sizes are Apple's pixels (1398 × 2034, 2670 × 1878) divided
  by 3; its safe insets are unknown, so 0. The iPhone 18 Pro and Pro Max take the insets of the
  16 Pro and Pro Max, the same screens.
- **frame** (`"modern" | "home-button"`, R9): only the SE 3 has `"home-button"`; gameView draws
  it with 64 px bands and a round home button. Every other preset is `"modern"`.
- Every corner radius is an estimate from device photos; Android insets and radii still need a
  real-device check.
- A foldable has `fold: { cover, inner }`. Its top-level size is the cover screen. `folded`
  (default `true`) picks the screen; `screenOf(preset, folded)` gives the DeviceSpec in use.

### The game frame (D-14)

One `<iframe data-game-frame>` for the page's life, inside `<div data-frame-layer>` (fixed, above
the content) → `<div data-frame-box>` (device size, `transform: translate() scale()`). It never
moves in the DOM. Docking writes a transform and a `clip-path`: the clip insets plus the screen's
round corners, `inset(… round <radius>px)`. Both are in the box's local px, so the transform shows
the corner as `radius × scale` on screen, on the Game stage and in the pinned preview alike. A
corner on a side the clip cuts stays square: only the device's own corners are round.

| Where | Frame |
|---|---|
| Game workspace | Over the stage slot gameView docks. `fit` (scale capped at 1) or `actual`. |
| Other workspace, preview visible | Over the preview body. The game takes the pointer and the keyboard: the preview plays the game. |
| Otherwise | Hidden. |

The docked iframe has `tabIndex` 0, the hidden one -1.

### The pinned preview

The header is the handle: a drag on it moves the float and snaps it to the nearest corner;
Alt+arrows on it move it a corner. The body belongs to the game. The size changes only through
S/M/L. "Open in Game (⌘1)" shows the Game workspace.

The float is clamped to its zone: 12 px plus the zone insets from every edge, so it stays between
the rail and an open drawer. A size the zone has no room for is fitted: it scales down with its
aspect kept, never below the height of S. When the fitted width is below 96 px (a wide Inspector
in the 480 px pane), the float collapses to its header (`data-collapsed`): title, S/M/L, Open in
Game and Hide. The body hides and the game frame with it.

### Reference mode (D-27)

The top-bar button (`data-action="reference"`, `aria-pressed`), key R, the palette item
"Reference mode on/off" and `setReference` drive it. While it is on, the frame box carries
`data-reference`: the overlay takes the pointer, so the game gets no input, and a 1 px accent
outline marks the frame. gameView draws its element proxies into `gameFrame().overlay()`. Esc
turns it off (layer `reference`, just before `selection`).

### Reload spinner (U9)

The overlay holds one `<div data-frame-reloading aria-hidden="true">`, created with it. It shows
while the link is `lost` to an expected reload (`isReloading`), and hides when the game beats
again. It is the only reload indicator: absolute, centred on the game, 24 px on screen at any
frame scale (`calc(24px / var(--frame-scale, 1))`). Nothing outside the frame moves.

### Tap ripples

workspace subscribes once to `link.onTap`. While the frame is docked and Show taps is on, a tap
draws a 20 px accent ring at the tap point in the overlay (device px). It grows to 36 px and fades
in 400 ms. Under reduced motion it is a static dot for 300 ms. At most 8 live at once. The palette
item "Show taps in the game" turns them on or off; its hint says `on` or `off`.

### Density

`auto` (the default) is compact below 820 px of window width and comfortable from there. It is
re-resolved on every window resize. The palette items `workspace:density-auto`, `-compact` and
`-comfortable` ("Density: …") choose it; the one in use is dimmed. The tokens are in
`styles/tokens.css`.

Every float that can cover the frame uses the browser top layer (`<dialog>` or `popover`).

The frame loads `link.frameUrl(url)`: the game URL with this tools page's frame id in the
`__editorFrame` query parameter. `gameFrame().url` stays the untagged game URL.

Before `mount` there is no iframe: `box()` is `undefined` and `reload()` resolves
`{ restored: false, reason: "not_mounted" }`.

### reload (D-07)

`reload({ restore: true })`: `game.bookmark`, and whether the link is `paused` →
`link.expectReload()` → `iframe.src` reassigned on the same element → first manifest of this tab's own embedded frame (a manifest
whose page carries another tools page's frame id is skipped) → `game.restore { bookmark }` →
`game.pause` when the game was paused and the new manifest lists it → toast "Game reloaded · state
restored from the last checkpoint". A failed `game.pause` is the warn `workspace:pause-failed`; the
result stays `{ restored: true }`. Concurrent calls share one run and schedule one more after it.
Bookmark, restore and pause are not user runs: no `workspace:ran`. `link.expectReload()` makes the
session close of the reload an expected reload (U7): the link reads `lost` with `reloading: true`.

### Expected reload (U7)

A link `lost` with `reloading: true` is a reload on purpose: a server restart (close 1012), this
reload, the Hot reload switch, or a game that said bye before Bun's full reload. Until the game is
back, the editor stands still (U9): only the frame spinner shows it.

| Where | Real loss (`lost`) | Expected reload (`lost`, `reloading: true`) |
|---|---|---|
| Stale bar | `data-tone="error"`: "Stale · data from frame N · {reason}, reconnecting in N s · Retry now" | hidden |
| Link pill | `data-kind="lost"`, red: "Lost · retry in N s" | `data-kind="live"`: "Live · f{lastFrame}" |
| Frame | nothing | the reload spinner |

The stale bar is an overlay: absolute over the top of the workspace area, never in the layout
flow. The pill text keeps a 19ch minimum width, so a status change never moves the top bar.
"Retry now" is in the stale bar only.

When the game is not back within link's `reloadGraceMs` (5000 ms), link sends a plain `lost` and
the red texts show.

`gameFrame().reload()` is the reload after a save (flowView calls it after writing a file). With
Bun hot reload on (`link.hotReload().hmr`), Bun reloads the game page itself:

1. The run listens for this tab's new session first, then takes the bookmark.
2. A new session within `hotReloadWaitMs` (1500 ms) ends the wait: no second reload.
3. Its hello carries `manifest.restored` (the bridge restored its checkpoint): toast "Game reloaded
   · state restored", result `{ restored: true }`, no second restore and no second pause.
4. Without `restored`, workspace restores its own bookmark as above (the D-07 fallback).
5. No new session within `hotReloadWaitMs`: the frame reloads itself as above.

In the same wait the run watches `game.log` (U10). The value is the whole trace, oldest first. An
entry of event `ui:hot-swap` (`isHotSwapEntry`) logged at or after the save means the game
swapped the module in place: the run ends with `{ restored: false, reason: "hot_swap" }` and the
toast "Game updated". No frame reload, no restore. Whichever comes first, the session or the hot
swap, ends the other wait.

A bookmark that fails because Bun's reload already took the page is warned only when the run
needs it (steps 4 and 5). The palette's "Reload game" items never wait for Bun. A session that
ends the D-07 wait with `restored` is not restored again either.

### Hot reload (round 2 R6, D-32)

The switch shows link's state: `hotReload()` is `{ hmr, owner }` from the hub. It is a
checkbox-style toggle: `role="switch"` with `aria-checked` in the wide bar, an icon with
`aria-pressed` in the compact bar, a `menuitemcheckbox` row in the ⋯ menu. Only the bin owns it
(`owner: "bin"`). The bin switches by restarting its server with HMR flipped (pages README, Hot
reload), and the game page has to load again to gain or drop Bun's HMR client. A flip (click, ⋯
row or key H) under the bin:

1. Takes the checkpoint first: `game.bookmark`, and whether the game is paused. It also starts
   waiting for this tab's game to connect again. The bin restarts its server right after it
   answers, so both happen before the ask.
2. Asks `link.setHotReload(on)`. An accepted switch toasts "Hot reload on" or "Hot reload off".
3. Waits for this tab's game on the restarted server, at most `reloadTimeoutMs`. Then the server
   serves again.
4. Reloads the game frame with that checkpoint, as the D-07 reload does. The new session gets
   `game.restore`, then `game.pause` when the game was paused. Toast "Game reloaded · state
   restored from the last checkpoint".

A game outside the editor is not waited for: its toast says "The game runs outside the editor ·
reload it there". Asking for the value hot reload already has takes no checkpoint and reloads
nothing.

The hint shows only when nothing switched. A game's own server (`owner: "server"`): "The game's
own server sets hot reload". A failed switch (the restart failed, or link saw no reconnect in
time): "Could not switch · start the bin with --no-hmr to turn hot reload off" (or "…without
--no-hmr to turn hot reload on"). The hint toasts and stays in the switch's tooltip until the
state changes. For a game's own server and before the hub reported the state, the switch is inert
with its reason in the tooltip; key H toasts the reason.

A session that comes back with `manifest.restored` after an outside edit (an agent writing a file)
toasts "Game reloaded · state restored" once per restore; workspace does not restore or pause it.

| `reason` | When |
|---|---|
| `not_mounted` | No `mount` yet. |
| `not_embedded` | The game runs outside the editor. |
| `no_session` | No game connected. |
| `bookmark_failed` | `game.bookmark` failed. |
| `restore_failed` | `game.restore` failed. The game stays at its fresh start. |
| `timeout` | No new session within `reloadTimeoutMs`. |
| `hot_swap` | After a save the game swapped the module in place. Nothing reloaded or restored. |

### Keys and Esc

| Key | Action |
|---|---|
| ⌘1–⌘6 and 1–6 | Game · Flow · Render · State · Files · Console |
| ⌘K | Palette, also in inputs |
| `.` | Step one frame, only while paused |
| P | Pause / resume |
| O | Overlay in game on / off |
| G | Show / hide the preview of the current workspace |
| R | Reference mode on / off |
| H | Hot reload on / off (asks the server). In Flow, flowView's H (History) wins. |
| Esc | Closes one thing, in this order: palette → contactSheet → contextMenu → registry → seriesPopover → captureCard → picker → fileEdit → codeEdit → stepPopover → reference → selection |

- `mod` is ⌘ on Apple platforms, Ctrl elsewhere.
- Single keys are ignored in fields unless the binding sets `inInputs`.
- While the palette is open, only the palette handles keys.
- Bindings of the active workspace win over global ones.
- `keys.bind` throws `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash where neither binding has `when`.
- Within one Esc layer, the latest registration is asked first.
- workspace registers the Esc layers `palette`, `contextMenu` (the session menu and the ⋯ menu), `registry`, `stepPopover` and `reference`. The views register the rest.

## Events

workspace declares no plugin events. It uses global tools events from `src/config.ts`.

| Direction | Event | Payload | When |
|---|---|---|---|
| emits | `workspace:changed` | `{ ws: WorkspaceId }` | `show()` changed the workspace. |
| emits | `workspace:ran` | `RanEvent` | A command the shell ran for the user settled. Origins `topbar`, `key`, `palette`. |
| emits | `workspace:density` | `{ density: "compact" \| "comfortable" }` | The applied density changed: a choice, or `auto` crossing 820 px on a resize. |
| emits | `workspace:reference` | `{ on: boolean }` | Reference mode turned on or off. |
| hooks | `link:status` | `{ status, session? }` | Stores the status for the pill, stale bar and cards. Shows the frame spinner while the link reloads on purpose (U9). Runs a 1 s ticker while `silent` or `lost`. Closes the step popover when not live or paused. |

`RanEvent` = `{ id, input, origin, at }` plus `{ ok: true, result }` or `{ ok: false, error }`.

## Dependencies

| Kind | What |
|---|---|
| `depends` | `linkPlugin`: `status`, `manifest`, `onManifest`, `onTap`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`, `hotReload`, `onHotReload`, `setHotReload`. |
| Global events | emits `workspace:changed`, `workspace:ran`, `workspace:density`, `workspace:reference`; hooks `link:status`. |
| Packages | `preact`, `preact/hooks`. Dev: `happy-dom` for the component tests. |

## Usage

The tools page entry mounts the shell after start (R3). `onStart` never mounts.

```ts
import { createApp } from "@moku-labs/editor/tools";

const tools = createApp({ pluginConfigs: { workspace: { defaultWorkspace: "flow" } } });
await tools.start();
tools.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
```

From a view plugin:

```ts
const workspace = ctx.require(workspacePlugin);
workspace.keys.bind({ keys: "c", label: "Show where the game is", workspace: "flow", run: findCurrent });
```

## Lifecycle

| Phase | Does |
|---|---|
| `onInit` | Validates config, loads prefs, reads the OS theme, the density and the hash, registers built-in keys, Esc layers and palette Commands. No DOM writes. |
| `onStart` | Adds window listeners (keys, resize with the auto density and the top-bar layout, scroll), the `link.onManifest` listeners (palette, overlay re-apply; the restore toast), the `link.onTap` listener (ripples) and the `link.onHotReload` listener (the switch). No mount. |
| `mount(el)` | Renders the shell, sets `data-theme` and `data-density` on `<html>`, attaches hosts, creates the frame layer once. |
| `onStop` | Runs every cleanup, clears toast, ticker, reload and ripple timers, unrenders, removes the frame layer and the hosts. |

## Integration notes

- `panels` renders into `host(ws)` and mounts on `workspace:changed`. Hosts exist before `mount`, so panels can render in its own `onStart`.
- `panels.run` emits `workspace:ran` with origin `panel`. Views never emit it themselves.
- gameView docks the frame with `gameFrame().dock(slot, { fit })` and draws over it with `gameFrame().overlay()`.
- Views add palette items, key bindings, Esc closers and preview zones. Each returns a remover.
- consoleView and stateView hook `workspace:ran`.

## Styles

`styles/index.css` declares `@layer reset, tokens, base, components, animations, utilities` and
pulls every sheet of the plugin. The tools page CSS entry imports it first. Token values live only
in `styles/tokens.css`. TypeScript names for them are in `../panels/shared/tokens.ts`. See
[`styles/README.md`](styles/README.md).

## Limits

- Keys pressed while the game iframe has focus go to the game. A click in the preview or on the Game stage gives the game the keys; a click outside the device returns them.
- The browser may keep ⌘1–⌘6. Bare 1–6, the rail and the palette are the fallback.
- A hidden iframe can be throttled by the browser. The link pill shows the frame number stop.
- localStorage missing, full or corrupt: defaults and one warn. Nothing essential is stored. A record from before density, Show taps and sound loads them as their defaults.

## Breaking changes (round 2b)

- `DeviceSpec.frame` (`"modern" | "home-button"`) is required.
- Five presets are new (iPhone 17e, Air, 18 Pro, 18 Pro Max, Duo); every earlier id stays. The
  SE 3 is named "iPhone SE 3 · small, 2022".
- The default device is the iPhone 18 Pro (was the iPhone 15), also for an unknown stored id.
- `Prefs` (the `onPrefs` payload) gains `muted`; `WorkspaceApi` gains `muted()` and `setMuted()`.
- The compact top bar shows the Reference mode and Hot reload icon toggles before the search;
  Pause and Step carry their label as the accessible name only.

## Breaking changes (round 2)

- `DeviceSpec.dpr`, `radius` and `group` are required. Ten presets are new; the six ids stay.
  iPhone SE is "iPhone SE 3", iPad mini is "iPad mini 7". Pixel 8 and iPad mini report no safe
  insets (research table), so they have no safe bands.
- `DeviceChoice` gains `folded`; `setDevice` takes `folded`.
- Below 900 px the top bar is compact: Preview, Overlay, Reference mode, Hot reload, Registry,
  Density and Theme move into the ⋯ menu, and the session chip into the link pill.
- The wide bar's switches read "Preview" and "Overlay" (were "Game" and "Overlay in game"); the
  Registry button shows its icon only.
- The dark theme's bezel is `#2c2c34` (was `#1b1b20`). The primitive `--color-bezel` is now
  `--color-light-bezel` and `--color-dark-bezel`; views keep using `--bezel`.

## Breaking changes (Claude-pane round)

- `defaultWorkspace` defaults to `"game"`.
- ⌘1 is Game and ⌘2 is Flow (was Flow, Game).
- A click on the preview body no longer cycles the size: the game gets it.
