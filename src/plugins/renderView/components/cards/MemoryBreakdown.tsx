/**
 * @file renderView components (cards) — the process memory breakdown (spec 09 § M9 Memory): per
 * process of a wired phone ("App, pid 23811 — 541 MB", "WebView renderer — 424 MB") its parts with 3 px
 * bars, when it was read, the source ("dumpsys meminfo") and what Graphics and GL are.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { breakdownOf } from "../../derive/memory";
import { oneDecimal } from "../../derive/words";
import type { RenderViewCtx } from "../../types";
import { Popover, PopoverHead } from "../connection/Popover";

/**
 * Props of `MemoryBreakdown`.
 */
export type MemoryBreakdownProps = { readonly ctx: RenderViewCtx };

/**
 * The breakdown popover.
 *
 * @param props - ctx.
 * @returns The popover.
 */
export function MemoryBreakdown(props: MemoryBreakdownProps): JSX.Element {
  const { ctx } = props;
  const name = ctx.require(activeSourcePlugin).label().name;
  const processes = breakdownOf(ctx.state.mission.telemetry, Date.now());
  return (
    <Popover ctx={ctx} id="memory" label="Process memory">
      <div data-memory-breakdown>
        <PopoverHead ctx={ctx} id="memory" title={`Process memory on ${name}`}>
          <span data-tag="">dumpsys meminfo</span>
        </PopoverHead>
        <div data-part="columns">
          {processes.map(process => {
            const largest = Math.max(1, ...process.parts.map(part => part.mb));
            return (
              <section key={process.title} data-part="process">
                <h4>{process.title}</h4>
                <p data-part="read">{process.read}</p>
                <ul>
                  {process.parts.map(part => (
                    <li key={part.name}>
                      <span>{part.name}</span>
                      <b>{oneDecimal(part.mb)} MB</b>
                      <i aria-hidden="true">
                        <span style={{ inlineSize: `${Math.round((part.mb / largest) * 100)}%` }} />
                      </i>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <footer>
          Graphics and GL are textures and buffers the GPU driver holds for the process.
        </footer>
      </div>
    </Popover>
  );
}
