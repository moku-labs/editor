/**
 * @file gameView plugin — the Element panel's SidePanel (finding 2, D-29): its id (the
 * localStorage key `moku-editor:panel:game.side`), its title and its sizes, read by the panel,
 * the toolbar's reopen button, the palette item and the `\` binding.
 */

/**
 * The SidePanel id of the Game workspace's Element panel.
 */
export const SIDE_PANEL = "game.side";

/**
 * The title of the Element panel: its head, its rail and its aria-label.
 */
export const SIDE_TITLE = "Element panel";

/**
 * The sizes of the Element panel in px, and the Game body width below which it floats over the
 * stage as a drawer.
 */
export const SIDE_SIZE = { defaultWidth: 280, minWidth: 220, maxWidth: 520, overlayBelow: 600 };
