/**
 * @file overlay plugin — the link dot: the bridge link kind as a coloured dot with a label.
 */
import type { VNode } from "preact";
import type { LinkStatus } from "../../registry/protocol";

/**
 * Props of `LinkDot`: the link kind (colour key) and its label.
 *
 * @example
 * ```ts
 * const props: LinkDotProps = { kind: "live", label: "Editor live · frame 12" };
 * ```
 */
export type LinkDotProps = { readonly kind: LinkStatus["kind"]; readonly label: string };

/**
 * The link dot: colour from `data-kind`, never the only signal (label as name and title).
 *
 * @param props - The kind and the label.
 * @returns The dot.
 * @example
 * ```tsx
 * <LinkDot kind="live" label="Editor live · frame 12" />
 * ```
 */
export function LinkDot(props: LinkDotProps): VNode {
  return (
    <span
      data-dot=""
      data-kind={props.kind}
      role="img"
      aria-label={props.label}
      title={props.label}
    />
  );
}
