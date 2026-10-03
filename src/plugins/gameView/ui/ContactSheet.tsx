/**
 * @file gameView plugin — the contact sheet (E2): a modal `<dialog>` (top layer, focus trap,
 * focus return) with the header, the bug count, the grid of tiles (thumbnail, "fN +ms", bug
 * toggle), the large view (‹ ›, shot, frame, time, device, Mark as bug, filmstrip) and the footer
 * (saved folder, note select for the index.json).
 */
import type { VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { folderOf } from "../capture/naming";
import { closeSheetLayer, showShot, stepSheet, toggleBug } from "../capture/sheet";
import type { GameViewCtx, SeriesIndex, Sheet } from "../types";
import { NoteSelect } from "./NoteSelect";
import { secondsText } from "./text";
import { useGameView } from "./useGameView";

/**
 * Props of `ContactSheet`.
 */
export type ContactSheetProps = { readonly ctx: GameViewCtx; readonly node: string | undefined };

/**
 * The sheet header: label, shots, length, interval, first frame, stopped early.
 *
 * @param index - The series index.
 * @returns The title.
 * @example
 * ```ts
 * sheetTitle(index); // "Series · merge refused shake · 20 shots · 2 s at 100 ms · from frame 1777"
 * ```
 */
function sheetTitle(index: SeriesIndex): string {
  const head = `Series · ${index.label} · ${index.shots.length} shots`;
  const timing = `${secondsText(index.durationMs)} s at ${index.intervalMs} ms`;
  const tail = index.stoppedEarly === true ? " · stopped early" : "";
  return `${head} · ${timing} · from frame ${index.fromFrame}${tail}`;
}

/**
 * A shot image, or the placeholder of a missing file.
 *
 * @param props - The data URL and the alt text.
 * @param props.image - The data URL, undefined when missing.
 * @param props.alt - The alt text.
 * @returns The image or placeholder.
 */
function ShotImage(props: { readonly image: string | undefined; readonly alt: string }): VNode {
  return props.image === undefined ? (
    <span data-part="missing">Missing</span>
  ) : (
    <img src={props.image} alt={props.alt} />
  );
}

/**
 * The large view of one shot.
 *
 * @param props - The context, the sheet and the shot index.
 * @param props.ctx - Domain context of gameView.
 * @param props.sheet - The sheet.
 * @param props.big - The shot index.
 * @returns The large view, undefined for a shot that does not exist.
 */
function BigView(props: {
  readonly ctx: GameViewCtx;
  readonly sheet: Sheet;
  readonly big: number;
}): VNode | undefined {
  const { ctx, sheet, big } = props;
  const { shots, device } = sheet.index;
  const shot = shots[big];
  if (shot === undefined) return;
  return (
    <section data-part="big" aria-label="Shot">
      <div data-part="view">
        <button type="button" aria-label="Previous shot" onClick={() => stepSheet(ctx, -1)}>
          ‹
        </button>
        <ShotImage image={sheet.images[big]} alt={`Shot ${big + 1}`} />
        <button type="button" aria-label="Next shot" onClick={() => stepSheet(ctx, 1)}>
          ›
        </button>
      </div>
      <p data-part="position">
        Shot {big + 1} of {shots.length}
      </p>
      <dl data-props="">
        <dt>Frame</dt>
        <dd>{shot.frame}</dd>
        <dt>Time</dt>
        <dd>+{shot.atMs} ms</dd>
        <dt>Device</dt>
        <dd>{device === undefined ? "Not recorded" : `${device.name} ${device.orientation}`}</dd>
      </dl>
      <button type="button" aria-pressed={shot.bug} onClick={() => toggleBug(ctx, big)}>
        Mark as bug <kbd>B</kbd>
      </button>
      <div data-part="strip">
        {shots.map((entry, index) => (
          <button
            key={entry.file}
            type="button"
            aria-label={`Shot ${index + 1}`}
            aria-current={index === big ? "true" : undefined}
            data-bug={entry.bug ? "" : undefined}
            onClick={() => showShot(ctx, index)}
          >
            <ShotImage image={sheet.images[index]} alt="" />
          </button>
        ))}
      </div>
      <p>Step with ← → · Back to the sheet with Esc</p>
    </section>
  );
}

/**
 * The grid of tiles.
 *
 * @param props - The context and the sheet.
 * @param props.ctx - Domain context of gameView.
 * @param props.sheet - The sheet.
 * @returns The grid.
 */
function Grid(props: { readonly ctx: GameViewCtx; readonly sheet: Sheet }): VNode {
  const { ctx, sheet } = props;
  return (
    <ul data-part="grid">
      {sheet.index.shots.map((shot, index) => (
        <li key={shot.file} data-part="tile" data-bug={shot.bug ? "" : undefined}>
          <button
            type="button"
            data-part="open"
            aria-label={`Open shot ${index + 1}`}
            onClick={() => showShot(ctx, index)}
          >
            <ShotImage image={sheet.images[index]} alt="" />
            <span data-part="caption">
              f{shot.frame} +{shot.atMs} ms
            </span>
          </button>
          <button
            type="button"
            data-part="bug"
            aria-pressed={shot.bug}
            aria-label={`Mark shot ${index + 1} as bug`}
            onClick={() => toggleBug(ctx, index)}
          >
            B
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Opens the dialog modally and remembers the focus to return it on close.
 *
 * @param dialog - The dialog element.
 * @returns Returns the focus.
 */
function openModal(dialog: HTMLDialogElement | null): () => void {
  const opener = document.activeElement;
  if (dialog !== null && !dialog.open && typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch {
      // Not connected: the dialog shows inline.
    }
  }
  return () => {
    if (opener instanceof HTMLElement) opener.focus();
  };
}

/**
 * The contact sheet.
 *
 * @param props - The context and the node of the watched position.
 * @returns The dialog, undefined without a sheet.
 */
export function ContactSheet(props: ContactSheetProps): VNode | undefined {
  const { ctx, node } = props;
  const { state } = ctx;
  const sheet = useGameView(state, () => state.series.sheet);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = sheet !== undefined;
  useLayoutEffect(() => (open ? openModal(dialog.current) : undefined), [open]);
  if (sheet === undefined) return;

  const bugs = sheet.index.shots.filter(shot => shot.bug).length;
  return (
    <dialog
      data-game="sheet"
      aria-modal="true"
      aria-labelledby="game-sheet-title"
      ref={dialog}
      onCancel={event => event.preventDefault()}
    >
      <header>
        <h2 id="game-sheet-title">{sheetTitle(sheet.index)}</h2>
        {bugs > 0 && (
          <span data-tag="warn" data-part="bugs">
            {bugs} marked as bug
          </span>
        )}
        <button type="button" aria-label="Close" onClick={() => closeSheetLayer(ctx)}>
          ×
        </button>
      </header>
      {sheet.big === undefined ? (
        <Grid ctx={ctx} sheet={sheet} />
      ) : (
        <BigView ctx={ctx} sheet={sheet} big={sheet.big} />
      )}
      <footer>
        <p data-part="saved">Saved to {folderOf(sheet.indexPath)} · index.json</p>
        <NoteSelect ctx={ctx} capture={sheet.indexPath} node={node} />
      </footer>
    </dialog>
  );
}
