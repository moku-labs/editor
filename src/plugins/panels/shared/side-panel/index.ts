/**
 * @file Shared view module — the barrel of side-panel/ (D-29): the SidePanel component, the
 * useSidePanel hook and the plain functions a view's reopen button, palette item and `\` key use.
 */
export type { SidePanelHandle, SidePanelProps } from "./SidePanel";
export { SidePanel, useSidePanel } from "./SidePanel";
export type { SidePanelState } from "./store";
export { showSidePanel, sidePanelState, toggleSidePanel } from "./store";
