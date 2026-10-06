/**
 * @file renderView plugin — the textures card: bundle chips, the sortable table (sticky header,
 * sort arrows, aria-sort) and the row hover that rings the first scene node drawing the texture.
 */
import type { JSX } from "preact";
import { linkPlugin } from "../../link";
import { manifestOf, projectOffText } from "../../panels/shared/project";
import { filterTo, hoverTexture, sortBy } from "../actions";
import { bundleCounts, firstNodeWithTexture, textureRowsOf } from "../derive";
import { fixed, tagOfUse } from "../format";
import type { RenderViewCtx, TextureRow, TextureSortKey } from "../types";
import { refreshRenderView } from "../watch";

/**
 * Props of `TexturesCard`.
 */
export type TexturesCardProps = {
  readonly ctx: RenderViewCtx;
  /** The visible rows (filter and sort applied). */
  readonly rows: readonly TextureRow[];
};

/**
 * The table columns: sort key and header label.
 */
const COLUMNS: readonly (readonly [key: TextureSortKey, label: string])[] = [
  ["key", "Texture"],
  ["bundle", "Bundle"],
  ["size", "Size"],
  ["gpuMb", "GPU MB"],
  ["fileMb", "File MB"],
  ["use", "Use"]
];

/**
 * The tag tone of each texture use: unused warns, never seen is muted.
 */
const TONES: Readonly<Record<"in-use" | "unused" | "not-seen", string>> = {
  "in-use": "",
  unused: "warn",
  "not-seen": "mut"
};

/**
 * Props of `BundleChip`.
 */
export type BundleChipProps = {
  readonly ctx: RenderViewCtx;
  /** "all" or a bundle name. */
  readonly bundle: string;
  readonly label: string;
};

/**
 * One bundle chip of the radiogroup: picks the bundle filter.
 *
 * @param props - ctx, the bundle and its label.
 * @returns The chip.
 */
export function BundleChip(props: BundleChipProps): JSX.Element {
  const { ctx, bundle, label } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a chip is a button acting as a radio (design G chips)
    <button
      type="button"
      role="radio"
      data-chip
      aria-checked={ctx.state.table.bundle === bundle}
      onClick={() => filterTo(ctx, bundle)}
    >
      {label}
    </button>
  );
}

/**
 * Why there is no catalogue: the index is off, it names no manifest, or the named file holds no
 * version-1 asset manifest.
 *
 * @param ctx - Domain context of renderView.
 * @returns The reason.
 */
function noManifestText(ctx: RenderViewCtx): string {
  const project = ctx.require(linkPlugin).project();
  const path = manifestOf(project);
  const offText = projectOffText(project);
  if (offText !== undefined) return offText;
  return path === undefined
    ? "The project index found no asset manifest"
    : `No asset manifest of version 1 at ${path}`;
}

/**
 * The line under the head when the table has no rows.
 *
 * @param ctx - Domain context of renderView.
 * @returns The line, or undefined when there are rows to show.
 */
function emptyLine(ctx: RenderViewCtx): string | undefined {
  const { catalogue, assets } = ctx.state;
  if (catalogue === null) {
    return `${noManifestText(ctx)} · per-texture data needs game.textures (follow-up F-R2)`;
  }
  if (catalogue === undefined) return "The asset manifest is read when Render opens.";
  if (assets === undefined) return "Waiting for game.assets.";
  return undefined;
}

/**
 * The textures card.
 *
 * @param props - ctx and the visible rows.
 * @returns The card.
 */
export function TexturesCard(props: TexturesCardProps): JSX.Element {
  const { ctx, rows } = props;
  const { table, scene } = ctx.state;
  const all = textureRowsOf(ctx.state);
  const counts = bundleCounts(all);
  const empty = emptyLine(ctx);

  return (
    <section data-render="textures" data-card>
      <header>
        <h2>Textures</h2>
        <span data-note>GPU MB = w × h × 4</span>
        <button
          type="button"
          data-action="refresh"
          title="Read the asset manifest and the calibration again"
          onClick={() => void refreshRenderView(ctx)}
        >
          Refresh
        </button>
      </header>
      <div role="radiogroup" aria-label="Bundle">
        <BundleChip ctx={ctx} bundle="all" label={`All ${all.length}`} />
        {[...counts].map(([bundle, count]) => (
          <BundleChip key={bundle} ctx={ctx} bundle={bundle} label={`${bundle} ${count}`} />
        ))}
      </div>
      {empty === undefined ? undefined : <p data-empty>{empty}</p>}
      <table>
        <thead>
          <tr>
            {COLUMNS.map(([key, label]) => {
              const active = table.sort === key;
              const direction = table.dir === 1 ? "ascending" : "descending";
              return (
                <th
                  key={key}
                  scope="col"
                  data-sort={key}
                  data-dir={active ? direction : undefined}
                  aria-sort={active ? direction : undefined}
                >
                  <button type="button" onClick={() => sortBy(ctx, key)}>
                    {label}
                    {active ? (
                      <span aria-hidden="true">{table.dir === 1 ? " ↑" : " ↓"}</span>
                    ) : undefined}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const tag = tagOfUse(row.use);
            const onScreen = firstNodeWithTexture(scene, row.key) !== undefined;
            return (
              <tr
                key={row.key}
                data-key={row.key}
                data-use={tag.data}
                data-hover={table.hover === row.key ? "" : undefined}
                title={onScreen ? undefined : "not on screen"}
                tabIndex={0}
                onPointerEnter={() => hoverTexture(ctx, row.key)}
                onPointerLeave={() => hoverTexture(ctx)}
                onFocus={() => hoverTexture(ctx, row.key)}
                onBlur={() => hoverTexture(ctx)}
              >
                <td data-mono>{row.key}</td>
                <td>{row.bundle}</td>
                <td data-mono>
                  {row.width}×{row.height}
                </td>
                <td data-mono>{fixed(row.gpuMb)}</td>
                <td data-mono>{fixed(row.fileMb)}</td>
                <td>
                  <span data-tag={TONES[tag.data]}>{tag.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
