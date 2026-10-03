/**
 * @file renderView plugin — the release log card: the bundles that left game.assets since the
 * editor connected, newest first, at the frame of the last game.render (reason not reported, F-R3).
 */
import type { JSX } from "preact";
import type { ReleaseEntry } from "../types";

/**
 * Props of `ReleaseLogCard`.
 */
export type ReleaseLogCardProps = { readonly releases: readonly ReleaseEntry[] };

/**
 * The release log card.
 *
 * @param props - The entries, newest first.
 * @returns The card.
 * @example
 * ```tsx
 * <ReleaseLogCard releases={[{ frame: 1900, bundle: "ui", tier: "core", mb: 2 }]} />
 * ```
 */
export function ReleaseLogCard(props: ReleaseLogCardProps): JSX.Element {
  const { releases } = props;
  return (
    <section data-render="releases" data-card>
      <header>
        <h2>Release log</h2>
        <span data-sub>Since the editor connected · reason not reported (follow-up F-R3)</span>
      </header>
      {releases.length === 0 ? (
        <p data-empty>No bundle released since the editor connected.</p>
      ) : (
        <ol>
          {releases.map(entry => (
            <li key={`${entry.frame}:${entry.bundle}`}>
              ≈f{entry.frame} · {entry.bundle} · {entry.mb} MB freed
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
