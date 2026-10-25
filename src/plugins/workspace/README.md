# workspace

> Complex plugin, tools core (`@moku-labs/editor/tools`). The tools shell and the one game frame.

The shell of the tools page: top bar (B1) with the game mark and its ⋯ menu, rail with badges
(B2), pinned game preview (B3), step and registry popovers (D1, D2), link pill note (D7), command
palette (E1), toasts (F1), stale bar (F3) and the connecting and no-game cards (F4). It owns the
single game iframe, the device presets, the per-viewer preferences (theme, density, preview per
workspace, device and fold, Show taps, sound, Copy on select), the key map with the Esc unwinding,
the overlay-in-game switch, the Hot reload switch, the tap ripples and the D-07 reload. With
activeSource (spec 11 § 5.3) it shows the page's source: the source pill and its menu in the top
bar, the disconnect notice under it, the paused veil over the local frame, and it starts the local
preview on request (`startLocalPreview`). It also ships the shared CSS layer every view uses
(`styles/`).

The shell is built narrow first: it runs in a browser pane at a third (480 px) or half (720 px)
of the screen. Below 900 px the top bar is compact: Hot reload stays as an icon and the rest
moves into a ⋯ menu. At 560 px and narrower it also hides the game name, and the rail is 44 px of
icons. No workspace scrolls the page sideways.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `defaultWorkspace` | `WorkspaceId` | `"game"` | Workspace shown at start when the URL hash names none. |
| `storageKey` | `string` | `"moku-editor"` | localStorage key of the preferences record. |
| `reloadTimeoutMs` | `number` | `15000` | How long `reload()` waits for the new session. |
| `hotReloadWaitMs` | `number` | `1500` | After a save with Bun hot reload on: how long `gameFrame().reload({ afterSave: true })` waits for the page Bun reloads, or the game's hot swap, before it reloads the frame itself. |
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
| `hotReload` | `() => HotReload \| undefined` | link's `{ hmr, owner }`: whether Bun reloads the game after a save, and who owns the server. `undefined` until the hub reported it. |
| `setHotReload` | `(on) => Promise<boolean>` | Asks the server through `link.setHotReload`. An accepted switch reloads the game frame with its state once the restarted server serves again (D-32). A refusal or a failed switch toasts how to change it and keeps that hint in the switch tooltip. Never rejects. |
| `muted` | `() => boolean` | The sound flag (R11): `true` while the viewer muted the game. Persisted; `false` for a fresh viewer. |
| `setMuted` | `(on) => void` | Sets and persists the sound flag; `onPrefs` listeners get the new `muted`. The same value again does nothing. gameView sends `game.mute`; workspace never touches the game. |
| `copyOnSelect` | `() => boolean` | The Copy on select preference (U5, D-70): what a click of gameView's element picker does. On: the pick writes the reference (crop, full frame, card) and copies its line. Off: the pick only selects the element and writes nothing. Persisted; `true` for a fresh viewer and for a stored record without the field. |
| `setCopyOnSelect` | `(on) => void` | Sets and persists the preference; `onPrefs` listeners get the new `copyOnSelect` (the Copy Ref switch of gameView's game toolbar follows them). The same value again does nothing. No event: gameView reads `copyOnSelect()` at a pick. |
| `onPrefs` | `(fn) => () => void` | Called after every theme, preview, device, sound or Copy on select change with `{ theme, previews, device, muted, copyOnSelect }`. |
| `scenarios` | `() => ScenarioView` | `{ scenarios, chosen }`: the scenario names of `tests/scenarios/` (file stems, sorted) and the one the game frame starts from. A copy. Empty until the first listing and for a project without the folder. See [Scenarios](#scenarios-dev-only). |
| `setScenario` | `(name: string \| undefined) => Promise<ReloadResult>` | Starts the game frame from a scenario (`?player=<name>`), or from the saved player with `undefined`: reloads the frame without restore and toasts "Game started from scenario <name>" / "Game started from the saved player" instead of the reload's own toast. Before the first mount it stores the choice and resolves `not_mounted`. A name not listed rejects `[moku-editor] Unknown scenario "<name>".` (`TypeError`). Never persisted; emits no `workspace:ran`. |
| `refreshScenarios` | `() => Promise<ScenarioView>` | Lists `tests/scenarios/` again through `link.files.list`. Concurrent calls share one listing. A missing folder or a failed list gives no scenarios (debug `workspace:scenarios-failed`, no toast). |
| `onScenario` | `(fn) => () => void` | Called with the new view after the list changed or a scenario was chosen. A throwing listener is logged as `workspace:scenario-listener-failed`. |
| `startLocalPreview` | `() => Promise<void>` | W12. Mounts the one game frame when it is not mounted yet (the frame layer of the first `mount()`, docked by the current workspace's preview prefs; it does not show a hidden preview) and resolves once its session is listed (`link.ownSession()` answers); at once when it already is. Two calls in flight share one promise. A page without a game frame (the tools page of `moku-editor perf`: its device mode belongs to perf, `editor.devices` `mode.owner` "other") rejects and mounts nothing: `[moku-editor] workspace.startLocalPreview() needs a game frame.\n  This page shows a device only; open the tools page of moku-editor <game> to run the game here.` No session within 15 s rejects: `[moku-editor] The local preview did not start.\n  Check the game's console in the Console workspace; the frame is mounted at <url>.` onStop drops the wait and settles nothing. renderView's "Start local preview" buttons call it. |

```ts
workspace.show("flow");
workspace.setDensity("compact");
workspace.density(); // "compact"
workspace.setCopyOnSelect(false); // persisted; a pick only selects the element, nothing is written
workspace.copyOnSelect(); // false
workspace.preview("flow").size; // "S"
workspace.setPreview("render", { visible: false });
workspace.device().preset.w; // 402: the iPhone 18 Pro of a fresh viewer
workspace.setDevice({ orientation: "landscape" });
workspace.setDevice({ preset: "galaxy-z-fold-6", folded: false }); // the inner screen, 707 × 823
workspace.setMuted(true); // persisted; onPrefs listeners get { …, muted: true }
workspace.muted(); // true
workspace.hotReload(); // { hmr: true, owner: "bin" } under the moku-editor bin
await workspace.setHotReload(false); // true: the bin restarts without HMR; the game reloads with its state
await workspace.gameFrame().reload({ restore: true }); // no save: the frame reloads at once
await workspace.gameFrame().reload({ restore: true, afterSave: true, since: savedAt }); // after a save written at savedAt
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

- **900 px and wider (`wide`)**: the game mark, game name, source pill, session chip, the computer's engine
  fingerprint (`span[data-part="engine"]`, mono, "engine 0.14.13+1ab7f2" from `link.engine()`;
  nothing while it is unknown; hidden below 1100 px of window width), link pill, Pause, Step,
  the search box, the switches Preview (G), Overlay (O) and Hot reload (H) with visible labels,
  Registry (icon only; the counts are in its title, "Registry · 12 sources · 30 commands"),
  theme. The row always fits: under 1360 px Pause and Step show their icons only, the game name
  drops its version and the source pill how the source is reached (its title keeps it); under
  1140 px the source pill shows its dot only (the name stays its accessible name). The search box
  gives up its room first: it is at its 88 px minimum before the game name shrinks.
- **Below 900 px (`compact`)**: the game mark, game name (hidden at 560 px and narrower), source
  pill (its name only), link pill, Pause and Step as icons (the label is their accessible name, the title says the key), then
  at the end the icon toggle Hot reload (`data-action="hot-reload"`, flame icon with a dot while
  on), a search icon and the ⋯ button (`data-action="more"`). The toggle carries `aria-pressed`;
  it is inert with the hint in its title when the bin does not own it. It is the one toggle of the
  bar at every compact width: `barToggles(width)` in `ui/TopBar.tsx` answers `["hot-reload"]`
  below 900 px and `[]` from there. The session chip is gone: the pill's tooltip names the session
  ("… · session s-7f3a · connected 22:41:07"), and with more than one session the pill opens the
  session menu. The game name's `title` carries the engine fingerprint ("merge-game 0.0.0 · engine
  0.14.13+1ab7f2") once link knows it.
- **The ⋯ menu** is a top-layer `role="menu"` popover. Rows: Game preview (G), Overlay in game
  (O), Hot reload (H), each with its state and its key (Hot reload is a row even though the bar
  shows it as an icon); then Registry (counts), Density (cycles auto → compact → comfortable) and
  Theme. A toggle row keeps the menu open; Registry opens the registry popover
  under the ⋯ button. A second ⋯ click, Esc or a press outside closes it. ↑/↓ move through the
  rows; opening it from the keyboard focuses the first row. Rows keep the `data-action` names of
  the wide controls (`game`, `overlay`, `hot-reload`, `registry`, `theme`) plus
  `density`. In the compact bar `hot-reload` names both the bar icon and the menu row: select the
  icon with `[data-ui="top-bar"] > [data-action]`, the row inside `[data-ui="more-menu"]`.

Every control keeps its size; only the game name and the wide search box shrink, and the search
box clips its own content, so no control runs over another.

### The source (spec 11 § 5.3 W8–W11)

The page reads one source at a time, chosen by activeSource: the local preview (this page's game
frame), a phone, or another game page. workspace shows it and routes every choice through
activeSource, which pauses the local preview while a phone is the source and resumes it after.

- **Source pill** (`[data-ui="source-pill"]`, `ui/SourcePill.tsx`): "Local preview" (neutral),
  "<name> · by wire" / "<name> · on the network" for a phone (14 % accent tint), "<game> · another
  page". The name is `activeSource.label().name` (the marketing name adb matched, else the model).
  `data-kind` is `local`, `device` or `page`; the 8 px dot (`data-state`) is `live` (pulsing) while
  the source's session is listed and its heartbeat is not silent, `away` otherwise. A click opens
  the **source menu** (top layer, `[data-ui="source-menu"]`): Local preview ("Not started" and
  inert while the frame has no session, "No game on this page" on the perf page), every linked
  phone (`by wire · 127.0.0.1`), each with Use, and Connect device…, which shows Render and calls
  `activeSource.openConnect()` (renderView opens its Connect panel). Esc closes it.
- **Session menu**: a row of a phone calls `activeSource.useDevice`, the row of this page's own
  frame `activeSource.useLocal`; only another game page goes to `link.choose` (before, every row
  called `link.choose`, so a phone chosen there ran next to the local game).
- **Disconnect notice** (`[data-ui="source-notice"]`, `ui/SourceNotice.tsx`): the shell grid's
  second row, under the top bar, full width, in every workspace, while `activeSource.notice()`
  holds (`role="status"`, `aria-live="polite"`; the region stays in the document and is 0 px high
  when empty). The text with its first sentence bold, Reconnect (`activeSource.reconnect()`; "Use"
  when the device is back, then its newest session is used if reconnect has nothing to rejoin),
  Dismiss (`dismissNotice()`), and a 2 px timer line that shrinks to the notice's end, still and
  dimmed while Reconnect waits. The notice goes at its `until` without an event: the region
  repaints then on its own.
- **Paused veil** (`[data-frame-veil]` in the frame overlay, `frame/veil.tsx`): while a phone is
  the source and `activeSource.preview()` is `paused-by-source`, the local frame is covered:
  "Paused" / "<name> is the source." / Use local preview (`useLocal()`). `unpausable` shows "Could
  not pause the local preview" with the reason. With the local preview as the source there is no
  veil, also while its resume is still in flight. The veil keeps its screen size at any frame
  scale and takes the pointer.

The pill, the notice and the veil repaint on `activeSource:changed` and on every session list
(`link.onSessions`: a phone linking or leaving, the local preview's pause taking hold).

### Scenarios (dev only)

The engine dev page starts from a prepared save when its URL carries `?player=<name>`: the file
`tests/scenarios/<name>.ts` of the game folder (engine `src/app/page.ts`). workspace lists that
folder once the link's socket is open (the first `link:status` that is not `connecting` or
`lost`), keeps the chosen name in its state and passes it to `link.frameUrl(url, { player })`
(`taggedGameUrl`, the one place the frame URL is made): the first mount, the D-07 reload and the
Hot reload switch's reload all keep it; Bun's own HMR reload keeps the frame's URL by itself.

- The file rule is the engine's: every `.ts` file directly in the folder but `*.test.ts`,
  `*.spec.ts`, `*.d.ts` and `index.ts`, by file stem, sorted (`scenarioNames`).
- `setScenario(name)` reloads the frame without restore: a scenario plays on a fresh memory save
  and a bookmark restored on top would undo it.
- The choice is never stored: a reload of the tools page starts from the saved player.
- A debug build carries no scenarios; the picker is a dev-server feature.
- gameView's game toolbar shows the control over this api (spec 09 W5).

### The game mark (U1)

`span[data-mark]` (`aria-hidden`) is the first thing in both layouts: a 24 px tile with the
initials of the game on a colour from its name, so two games in two panes are told apart at a
glance. `markOf(name)` in `mark.ts` is a pure function that gives both:

| Name | `text` | `hue` |
|---|---|---|
| Two words or more, split on whitespace, `-` and `_`: "Tic Tac Toe", "merge-game" | The first letters of the first two words, upper case: `TT`, `MG` | From the name |
| One word: "Merge", "x" | Its first two letters, upper case: `ME`. One letter stays one: `X` | From the name |
| No game: `undefined`, empty, or no word in it | `·` | `undefined` |

- The name is the manifest game string without its version, so a new version keeps the colour.
- The hue is the sum of every character code times its position (from 1), modulo 360, over the
  trimmed lower-case name. "merge-game" is 288, "Tic Tac Toe" is 7. The same game always gets the
  same colour.
- TopBar writes the hue as the inline custom property `--mark-hue`. It is the only inline style.
- `ui/TopBar.css` builds the colours from it: background `oklch(var(--mark-l-bg) 0.07
  var(--mark-hue))`, text `oklch(var(--mark-l-fg) 0.11 var(--mark-hue))`. The tile is mono, 11 px,
  weight 600, radius 6 px.
- `--mark-l-bg` and `--mark-l-fg` are tokens (`styles/tokens.css`): 0.92 and 0.38 in the light
  theme, 0.30 and 0.88 in the dark one.
- Without a game there is no `--mark-hue`: the tile uses `--surface-panel-2` and `--text-muted`.
- While the link reloads the mark holds the last name, as the game name does (U9).

### Preferences

One record per viewer in localStorage under `storageKey`:
`{ v: 1, theme?, previews, device, density, showTaps, muted, copyOnSelect }`. `onInit` loads it. A
field an older record does not have takes its default silently; a value of the wrong kind takes
its default with one `workspace:prefs` warn.

| Preference | Field | Default | Changed by | `onPrefs` |
|---|---|---|---|---|
| Theme | `theme` | none: the OS theme | `setTheme`, the theme button, the ⋯ row, the palette | yes |
| Preview per workspace | `previews` | visible, size S, bottom-right | `setPreview`, key G, the Preview switch or ⋯ row, the float header, the palette | yes |
| Device and fold | `device` | `iphone-18-pro`, portrait, folded | `setDevice`, the hub's `device` request | yes |
| Density | `density` | `auto` | `setDensity`, the ⋯ row, the palette | no; emits `workspace:density` |
| Show taps | `showTaps` | on | The palette item "Show taps in the game" | no |
| Sound | `muted` | `false` (sound on) | `setMuted` (gameView's Sound switch) | yes |
| Copy on select | `copyOnSelect` | `true` | `setCopyOnSelect` (the Copy Ref switch of gameView's game toolbar), the palette command "Copy reference on select: turn off" / "… turn on". No key | yes |

Copy on select (U5, D-68, D-70) decides what a click of gameView's element picker does. On: the
pick writes the reference (the crop, the full frame, the card) and copies its line. Off: the pick
only selects the element for the Element tab, and an area drag picks nothing. workspace only
keeps the flag and has no control for it in the top bar (D-72): the control is the Reference
switch of the game toolbar, beside Safe area and Sound. gameView reads `copyOnSelect()` at a
picker click.

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

**Safe insets on the game page (E-I1).** In a browser `env(safe-area-inset-*)` is 0, so the frame
hands the emulated device's insets to the game page itself. While the screen in use has safe
insets, `:root` of the game page carries `--moku-device-safe-top`, `-right`, `-bottom` and
`-left`, in CSS px of the emulated screen, for its orientation and fold (`resolveDevice`). A preset
without insets (Android, foldables, tablets, desktop) has none of the four. Each change (a device,
a turn, a fold) and each new page the frame loads sets them again, then the page gets the window
event `moku-native:insets`, so the engine lays the game out again. The engine reads them through
`var(--moku-device-safe-*, …)` in its `--moku-safe-*` chain. A re-dock with the same insets
writes and sends nothing. A game page of another origin is left alone. This is the one place
the editor writes into the game page outside `@moku-labs/game/inspect` and `/control`: the CSS
properties on `:root` and the `moku-native:insets` event are the page's own contract, the one the
native shell also uses.

### The pinned preview

The header is the handle: a drag on it moves the float and snaps it to the nearest corner;
Alt+arrows on it move it a corner. The body belongs to the game. The size changes only through
S/M/L. "Open in Game (⌘1)" shows the Game workspace.

The float is clamped to its zone: 12 px plus the zone insets from every edge, so it stays between
the rail and an open drawer. A size the zone has no room for is fitted: it scales down with its
aspect kept, never below the height of S. When the fitted width is below 96 px (a wide Inspector
in the 480 px pane), the float collapses to its header (`data-collapsed`): title, S/M/L, Open in
Game and Hide. The body hides and the game frame with it.

### Reload spinner (U9)

The overlay holds one `<div data-frame-reloading aria-hidden="true">`, created with it. It shows
while the link is `lost` to an expected reload (`isReloading`), and hides when the game beats
again. It is the only reload indicator: absolute, centred on the game, 24 px on screen at any
frame scale (`calc(24px / var(--frame-scale, 1))`). Nothing outside the frame moves: the top bar
keeps the game name and the session id of the last manifest (`state.shown`, `heldNames`) until a
real loss or no game, also in the moment between a session's close and the link status that
follows it. The reload-quiet scenario of the merge-game demo (moku-labs/demos) measures 0 layout shift on the tools page.

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

`reload({ restore: true })`: whether the developer paused the game (below), then `game.bookmark` →
`link.expectReload()` → `iframe.src` reassigned on the same element → first manifest of this tab's own embedded frame (a manifest
whose page carries another tools page's frame id is skipped) → `game.restore { bookmark }` →
`game.pause` when the developer had paused the game and the new manifest lists it → toast "Game
reloaded · state restored from the last checkpoint". A failed `game.pause` is the warn
`workspace:pause-failed`; the result stays `{ restored: true }`. Concurrent calls share one run and
schedule one more after it. Clock, bookmark, restore and pause are not user runs: no
`workspace:ran`. `link.expectReload()` makes the session close of the reload an expected reload
(U7): the link reads `lost` with `reloading: true`.

Only a pause the developer made is kept. A hidden tab pauses the game too (the reason
`background`), and the link reads `paused` for it all the same. That pause ends by itself when the
tab shows. `game.pause` after the restore would add the reason `devtools`, which stays: the game
would not run again until someone resumes it. So the checkpoint decides `paused` like this, before
the bookmark:

| Link | `editor.clock` | Checkpoint `paused` |
|---|---|---|
| `live` | not run | `false` |
| `paused` | answers `{ held: true }` (the reasons include `devtools`) | `true` |
| `paused` | answers `{ held: false }` (for example only `background`) | `false` |
| `paused` | not in the manifest (an older agent), or no manifest | `true`, not run |
| `paused` | the run fails, or the answer has no boolean `held` | `true`, debug `workspace:clock-failed` |

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

When the game is not back within link's `reloadGraceMs` (8000 ms), link sends a plain `lost` and
the red texts show.

`gameFrame().reload(opts)` takes `ReloadOptions`: `restore`, `afterSave` (default false) and
`since`. Only a save passes `afterSave: true` and `since`, the epoch ms the saver took before its
write (flowView's inspector, filesView, gameView's style save). The toolbar Reload and the palette
pass `restore` alone: the frame reloads at once, with no wait for Bun and no `game.log` watch.
After a save with Bun hot reload on (`link.hotReload().hmr`), Bun reloads the game page itself:

1. The run listens for this tab's new session first, then takes the bookmark.
2. A new session within `hotReloadWaitMs` (1500 ms) ends the wait: no second reload.
3. Its hello carries `manifest.restored` (the bridge restored its checkpoint): toast "Game reloaded
   · state restored", result `{ restored: true }`, no second restore and no second pause.
4. Without `restored`, workspace restores its own bookmark as above (the D-07 fallback).
5. No new session within `hotReloadWaitMs`: the frame reloads itself as above.

In the same wait the run watches `game.log` (U10). The value is the whole trace, oldest first. An
entry of event `ui:hot-swap` (`isHotSwapEntry`) logged at or after `since` means the game swapped
the module in place, also when Bun swapped it before the saver called `reload`: the run ends with
`{ restored: false, reason: "hot_swap" }` and the toast "Game updated". No frame reload, no
restore. The trace is read from its newest entry back to the first entry older than `since`.
Whichever comes first, the session or the hot swap, ends the other wait.

A call during a run asks for one more run with the first run's options; its hot swap wait counts
from the `since` of the latest call that gave one, else from its own start.

A bookmark that fails because Bun's reload already took the page is warned only when the run
needs it (steps 4 and 5). The palette's "Reload game" items and the toolbar Reload never wait for
Bun. A session that ends the D-07 wait with `restored` is not restored again either.

### Hot reload (round 2 R6, D-32)

The switch shows link's state: `hotReload()` is `{ hmr, owner }` from the hub. It is a
checkbox-style toggle: `role="switch"` with `aria-checked` in the wide bar, an icon with
`aria-pressed` in the compact bar, a `menuitemcheckbox` row in the ⋯ menu. Only the bin owns it
(`owner: "bin"`). The bin switches by restarting its server with HMR flipped (pages README, Hot
reload), and the game page has to load again to gain or drop Bun's HMR client. A flip (click, ⋯
row or key H) under the bin:

1. Takes the checkpoint first, as the D-07 reload does: whether the developer paused the game, and
   `game.bookmark`. It also starts waiting for this tab's game to connect again. The bin restarts
   its server right after it answers, so both happen before the ask.
2. Asks `link.setHotReload(on)`. An accepted switch toasts "Hot reload on" or "Hot reload off".
3. Waits for this tab's game on the restarted server, at most `reloadTimeoutMs`. Then the server
   serves again.
4. Reloads the game frame with that checkpoint, as the D-07 reload does. The new session gets
   `game.restore`, then `game.pause` when the developer had paused the game. Toast "Game reloaded ·
   state restored from the last checkpoint".

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
| H | Hot reload on / off (asks the server). In Flow, flowView's H (History) wins. |
| Esc | Closes one thing, in this order: palette → contactSheet → contextMenu → registry → seriesPopover → captureCard → picker → fileEdit → codeEdit → stepPopover → selection |

- `mod` is ⌘ on Apple platforms, Ctrl elsewhere.
- Single keys are ignored in fields unless the binding sets `inInputs`.
- While the palette is open, only the palette handles keys.
- Bindings of the active workspace win over global ones.
- `keys.bind` throws `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash where neither binding has `when`.
- Within one Esc layer, the latest registration is asked first.
- workspace registers the Esc layers `palette`, `contextMenu` (the session, source and ⋯ menus), `registry` and `stepPopover`. The views register the rest.

## Events

workspace declares no plugin events. It uses global tools events from `src/config.ts` and hooks
activeSource's per-plugin `activeSource:changed`.

| Direction | Event | Payload | When |
|---|---|---|---|
| emits | `workspace:changed` | `{ ws: WorkspaceId }` | `show()` changed the workspace. |
| emits | `workspace:ran` | `RanEvent` | A command the shell ran for the user settled. Origins `topbar`, `key`, `palette`. |
| emits | `workspace:density` | `{ density: "compact" \| "comfortable" }` | The applied density changed: a choice, or `auto` crossing 820 px on a resize. |
| hooks | `link:status` | `{ status, session? }` | Stores the status for the pill, stale bar and cards. Shows the frame spinner while the link reloads on purpose (U9). Runs a 1 s ticker while `silent` or `lost`. Closes the step popover when not live or paused. |
| hooks | `activeSource:changed` | `SourceChange` | Repaints the paused veil, the source pill and the disconnect notice. |

`RanEvent` = `{ id, input, origin, at }` plus `{ ok: true, result }` or `{ ok: false, error }`.

## Requests of the hub

The hub relays two editor-channel requests of a tools client (the MCP bridge) to this page
(D-60). `onInit` gives link one handler for each with `link.handle`; `onStop` removes them. The
handlers are in `requests.ts`. Empty params only read. A change runs the function the api method
runs, so the page behaves as after a click.

| Request | Params | Does | Answers |
|---|---|---|---|
| `device` | `DeviceParams`: `{ preset?, orientation?, folded? }` | With any field: checks `preset` against `devices()`, then changes the device as `setDevice` does. The frame resizes, the choice persists, `onPrefs` listeners run. | `DeviceInfo`: `{ preset, orientation, folded, w, h, presets }`. |
| `show` | `ShowParams`: `{ workspace? }` | With `workspace`: shows it as `show` does. Writes `#<ws>`, emits `workspace:changed` when it changed. Stores no preference: the workspace lives in the URL hash. | `ShowInfo`: `{ workspace, workspaces }`: the shown workspace and `WORKSPACE_NAMES`. |

`DeviceInfo` describes the device after the change:

- `preset` is the preset id, `orientation` the orientation.
- `folded` is `true` for the cover screen. It is always `true` for a preset without a fold,
  whatever flag is stored.
- `w` and `h` are the game viewport in CSS px: the screen in use (`device().preset`) through
  `resolveDevice`, so landscape swaps them.
- `presets` has one row per preset of `devices()`: `id`, `name`, `group`, `kind`, `w`, `h` and
  `foldable`. `w` and `h` of a row are the portrait size; for a foldable, its cover screen.

```ts
// The hub relays { preset: "pixel-8", orientation: "landscape" } as a `device` request.
// The page answers:
// { preset: "pixel-8", orientation: "landscape", folded: true, w: 915, h: 412, presets: [ … ] }

// { preset: "galaxy-z-fold-6", folded: false } answers the inner screen: w: 707, h: 823.
// {} changes nothing and answers the current device with the same fields.
```

An unknown preset id fails with -32602 `invalid_input` and `field: "preset"`. Nothing changes,
also when the request names an orientation or a fold too. The message is
`[moku-editor] editor.device: unknown preset "nokia".` and a hint line. It names the asked id
only, not the presets: they are the `presets` of any answer. link answers -32602 itself for a bad
shape (an unknown field, a workspace outside `WORKSPACE_NAMES`) before a handler runs.

`WorkspaceName` of the protocol and `WorkspaceId` are the same six names. The protocol imports no
plugin type, so it declares its own; a type test (`__tests__/unit/types.test.ts`) fails when they
differ.

## Dependencies

| Kind | What |
|---|---|
| `depends` | `linkPlugin`: `status`, `manifest`, `onManifest`, `onTap`, `run`, `sessions`, `session`, `choose`, `retry`, `boot`, `hotReload`, `onHotReload`, `setHotReload`, `handle`, `onSessions`, `ownSession`, `published("devices")`. `activeSourcePlugin` (after `linkPlugin`): `current`, `preview`, `label`, `notice`, `dismissNotice`, `reconnect`, `useDevice`, `useLocal`, `openConnect`. |
| Global events | emits `workspace:changed`, `workspace:ran`, `workspace:density`; hooks `link:status`. Per-plugin: hooks `activeSource:changed`. |
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
| `onInit` | Validates config, loads prefs, reads the OS theme, the density and the hash, registers built-in keys, Esc layers and palette Commands, and gives link the `device` and `show` request handlers. No DOM writes. |
| `onStart` | Adds window listeners (keys, resize with the auto density and the top-bar layout, scroll), the `link.onManifest` listeners (palette, overlay re-apply; the restore toast), the `link.onTap` listener (ripples), the `link.onHotReload` listener (the switch), the `link.onEngine` listener (the top bar's fingerprint) and the `link.onSessions` listener (the veil, the source pill, the notice). No mount. |
| `mount(el)` | Renders the shell, sets `data-theme` and `data-density` on `<html>`, attaches hosts, creates the frame layer once. |
| `onStop` | Runs every cleanup (the request handlers of link among them), clears toast, ticker, reload and ripple timers, forgets the scenario listeners, drops a pending `startLocalPreview` wait without settling it, unrenders, removes the frame layer and the hosts. A scenario listing that settles after stop changes nothing. |

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
- localStorage missing, full or corrupt: defaults and one warn. Nothing essential is stored. A record from before density, Show taps, sound and Copy on select loads them as their defaults.

## Breaking changes (the active source, spec 11 § 5.3)

- `depends` gains `activeSourcePlugin`: a tools composition with workspace must list
  `activeSourcePlugin` after `linkPlugin` (the default tools core does).
- The session menu no longer calls `link.choose` for a phone or for this page's own frame: it
  calls `activeSource.useDevice` / `useLocal`.
- `WorkspaceApi` gains `startLocalPreview()`; a hand-written full mock of it needs the member.

## Breaking changes (editor UI cleanup)

- Reference mode is gone (D-65): `reference()`, `setReference()`, the event `workspace:reference`,
  key R, the Esc layer `reference`, the palette item "Reference mode on/off", the top-bar toggle
  and the ⋯ row, `data-reference` on the frame box. gameView's picker is the one way to pick. The
  key R is free.
- `PaletteGroup` has no `"Styles"` (D-66): nothing adds items to it.
- `Prefs` (the `onPrefs` payload) gains `copyOnSelect`; `WorkspaceApi` gains `copyOnSelect()` and
  `setCopyOnSelect()`.
- The top bar starts with `span[data-mark]` (was `span[data-logo]`); the icon `logo` left
  `panels/shared/icons`.
- The compact bar keeps one icon toggle, Hot reload, at every width. `NARROW_BAR_MAX` is gone;
  `barToggles(width)` answers `["hot-reload"]` or `[]`.
- The ⋯ menu has no row where "Reference mode" was, and the ⋯ button title no longer names
  Reference mode: "More: preview, overlay, hot reload, registry, density, theme". The wide bar
  keeps three switches. Copy on select has no control in the top bar (D-72): its switch is
  "Copy Ref" in gameView's game toolbar.

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
