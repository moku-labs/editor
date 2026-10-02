# workspace styles

Two-layer design tokens (design-context §2), reset, base and the data-attribute primitives every
view uses. Rules land in wave 3.

- Layer order: `reset, tokens, base, components, animations, utilities` (declared in `index.css`).
- Top-layer rule (R4, D-14): the game iframe sits in a fixed layer above workspace content, so
  every float that can cover it (palette, popovers, menus, toasts, sheets, capture card) renders in
  the browser top layer (`<dialog>` or the `popover` attribute).
- Token names shared with TypeScript: `src/plugins/panels/shared/tokens.ts` (a panels test checks
  that every name there is declared in `tokens.css`).
- Fonts: vendored Geist and Geist Mono woff2 in `fonts/` (OFL-1.1), no CDN.
