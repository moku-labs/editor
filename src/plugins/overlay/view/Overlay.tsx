/**
 * @file overlay plugin — the root of the view: the pill or the card (nothing while hidden). Pure:
 * a function of the view model and the actions; `data-*` selectors only, no class attribute.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import type { OverlayView } from "../model/types";
import { Card } from "./Card";
import { Pill } from "./Pill";

/**
 * Props of `Overlay`.
 */
export type OverlayProps = { readonly view: OverlayView; readonly actions: OverlayActions };

/**
 * The overlay.
 *
 * @param props - The view and the actions.
 * @returns The pill, the card, or nothing while hidden.
 */
export function Overlay(props: OverlayProps): VNode | undefined {
  if (props.view.mode === "hidden") return undefined;
  return props.view.mode === "pill" ? (
    <Pill view={props.view} actions={props.actions} />
  ) : (
    <Card view={props.view} actions={props.actions} />
  );
}
