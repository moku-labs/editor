/**
 * @file renderView plugin — the bundles card: one row per loaded bundle (tier, "loaded", MB, a bar
 * against the largest bundle, file count and file MB when the manifest knows them) and the budget.
 */
import type { JSX } from "preact";
import type { AssetsUsage, BundleRow } from "../types";

/**
 * Props of `BundlesCard`.
 */
export type BundlesCardProps = {
  readonly rows: readonly BundleRow[];
  readonly assets: AssetsUsage | undefined;
};

/**
 * The bundles card.
 *
 * @param props - The bundle rows and game.assets.
 * @returns The card.
 */
export function BundlesCard(props: BundlesCardProps): JSX.Element {
  const { rows, assets } = props;
  return (
    <section data-render="bundles" data-card>
      <header>
        <h2>Bundles</h2>
        <span data-count>{rows.length}</span>
      </header>
      {assets === undefined ? (
        <p data-empty>Waiting for game.assets.</p>
      ) : (
        <ul>
          {rows.map(row => (
            <li key={row.name}>
              <span data-line>
                <span data-name>{row.name}</span>
                <span data-tag="">{row.tier}</span>
                <span data-tag="ok">loaded</span>
                <span data-mb>{row.mb} MB</span>
              </span>
              <span data-bar>
                <span style={{ inlineSize: `${Math.round(row.share * 100)}%` }} />
              </span>
              {row.files === undefined || row.fileMb === undefined ? undefined : (
                <span data-files>
                  {row.files} files · file {row.fileMb} MB
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {assets === undefined ? undefined : (
        <footer>
          Budget {assets.budgetMb} MB · used {assets.textureMb} MB
        </footer>
      )}
    </section>
  );
}
