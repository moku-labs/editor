/**
 * @file pages perf sub-domain — the hub's pairing callback for the terminal: it names the phone
 * and asks the person to type the 4-digit code the phone's screen shows. Typing the code (not
 * y/N) proves the person sees this phone, not another one on the LAN. The terminal is read only
 * through `PerfDeps.ask` (`deps.ts`).
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import type { PairConfirm } from "../../hub/types";
import type { PerfDeps } from "./types";

/** The question: the code is exactly four digits (hub spec 01 C4). */
const QUESTION = "  Type the 4-digit code on its screen (Enter refuses): ";

/** The note after a question the signal cut. */
const ABORTED = "  (the phone left or the wait ran out)";

/**
 * The hub's pairing callback for the terminal: names the phone and asks the person to type the
 * code its screen shows. Typing the code (not y/N) proves the person sees this phone, not another
 * one on the LAN. An aborted question (the phone left, the wait ran out, device mode stopped)
 * and any other throw answer false.
 *
 * @param ui - The brand console.
 * @param ask - The one terminal seam.
 * @returns The callback for `hub.listenDevices({ confirm })`.
 * @example
 * ```ts
 * const confirm = pairPrompt(ui, deps.ask);
 * await confirm({ code: "4821", model: "SM-A266B", address: "192.168.1.23", link: "lan", engine: "0.14.12+9c41e0", build: null }, signal);
 * // prints "◆ SM-A266B at 192.168.1.23 (lan) asks to link · engine 0.14.12+9c41e0", asks for the code; true when "4821" is typed
 * ```
 */
export function pairPrompt(ui: BrandConsole, ask: PerfDeps["ask"]): PairConfirm {
  return async (request, signal) => {
    const name = request.model ?? "A phone";
    const engine = request.engine === null ? "" : ` · engine ${request.engine}`;
    ui.line(`◆ ${name} at ${request.address} (${request.link}) asks to link${engine}`);

    let typed: string;
    try {
      typed = await ask(QUESTION, signal);
    } catch {
      if (signal.aborted) {
        ui.line(ABORTED);
        return false;
      }
      typed = "";
    }

    const linked = typed.trim() === request.code;
    ui.check(linked, `${linked ? "linked" : "refused"} ${name}`);
    return linked;
  };
}
