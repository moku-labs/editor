/**
 * @file renderView timeline — paints the connection bar's health line (spec 09 § M7): the 48 latency
 * samples of activeSource's ring, oldest to newest, scaled to 0…2 × their mean, a 1.25 px line in
 * the live colour; a missing sample (NaN) breaks the line. Allocation-free.
 */
import type { SourceHealth } from "../source/contract";
import { DASH } from "./draw";
import type { PaintContext, TimelineLayout } from "./layout";
import type { MissionPalette } from "./palette";

/**
 * The mean of the samples that are numbers.
 *
 * @param samples - The ring.
 * @returns The mean; NaN without a sample.
 */
function meanOf(samples: Float32Array): number {
  let sum = 0;
  let count = 0;
  // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint: no iterator per frame
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? Number.NaN;
    if (Number.isNaN(value)) continue;
    sum += value;
    count += 1;
  }
  return count === 0 ? Number.NaN : sum / count;
}

/**
 * Paints the latency sparkline: oldest sample at the left (the one after `head`), newest at the
 * right, `y` scaled so the mean sits at mid height.
 *
 * @param g - The canvas context.
 * @param layout - The canvas's geometry (`boxLayout`, 72 × 14).
 * @param health - activeSource.health().
 * @param palette - The colours.
 * @example
 * ```ts
 * paintHealth(g, boxLayout(72, 14, 2), app.activeSource.health(), palette);
 * ```
 */
export function paintHealth(
  g: PaintContext,
  layout: TimelineLayout,
  health: SourceHealth,
  palette: MissionPalette
): void {
  const { samples, head } = health;
  const count = samples.length;
  const mean = meanOf(samples);
  if (count < 2 || Number.isNaN(mean)) return;
  const top = 2 * mean || 1;
  const step = layout.plot.w / (count - 1);
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.strokeStyle = palette.live;
  g.lineWidth = 1.25;
  g.beginPath();
  let drawing = false;
  for (let index = 0; index < count; index += 1) {
    const value = samples[(head + 1 + index) % count] ?? Number.NaN;
    if (Number.isNaN(value)) {
      drawing = false;
      continue;
    }
    const x = index * step;
    const y = layout.plot.y + layout.plot.h - (Math.min(value, top) / top) * layout.plot.h;
    if (drawing) g.lineTo(x, y);
    else g.moveTo(x, y);
    drawing = true;
  }
  g.stroke();
}
