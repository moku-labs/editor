/**
 * @file pages perf sub-domain — the hub's pairing callback for the terminal: it names the phone
 * and asks the person to type the 4-digit code the phone's screen shows. Typing the code (not
 * y/N) proves the person sees this phone, not another one on the LAN. The terminal is read only
 * through `PerfDeps.ask` (`deps.ts`).
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import type { PairConfirm, PairRequest } from "../../hub/types";
import type { PerfDeps } from "./types";

/** The question: the code is exactly four digits (hub spec 01 C4). */
const QUESTION = "  Type the 4-digit code on its screen (Enter refuses): ";

/** The note after a question the signal cut. */
const ABORTED = "  (the phone left or the wait ran out)";

/** An engine fingerprint as the engine writes it: a version, then `+` and a hex hash. */
const ENGINE_ID = /^\d+\.\d+\.\d+(?:\+[\da-f]+)?$/;

/**
 * The engine part of the ask line: only an engine id or "unknown"; any other text is left out.
 *
 * @param engine - The engine the phone reported, or null.
 * @returns ` · engine <id>`, or "".
 * @example
 * ```ts
 * enginePart("type 1234 now"); // ""
 * ```
 */
function enginePart(engine: string | null): string {
  const isShown = engine !== null && (engine === "unknown" || ENGINE_ID.test(engine));
  return isShown ? ` · engine ${engine}` : "";
}

/**
 * Whether the phone's own text that the prompt prints shows the code: a phone that writes the code
 * into its model, or into an engine id the ask line prints, would get the person to type it from
 * the terminal instead of from its screen. Any occurrence counts, also inside a longer digit run
 * ("1014" in "SM-A10145"). The build is never printed, so a timestamp build ("20261014") does not
 * count.
 *
 * @param request - The pairing request.
 * @returns True when the printed model or the printed engine contains the code.
 * @example
 * ```ts
 * showsCode({ code: "1014", model: "SM-A10145", address: "192.168.1.23", link: "lan", engine: null, build: null }); // true
 * ```
 */
function showsCode(request: PairRequest): boolean {
  const printed = [request.model ?? "", enginePart(request.engine)];
  return printed.some(text => text.includes(request.code));
}

/**
 * The hub's pairing callback for the terminal: names the phone and asks the person to type the
 * code its screen shows. Typing the code (not y/N) proves the person sees this phone, not another
 * one on the LAN. A phone whose printed model or printed engine contains the code is refused
 * without a question; the engine prints only as an engine id or "unknown", the build never. An aborted question (the phone
 * left, the wait ran out, device mode stopped) and any other throw answer false.
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
    if (showsCode(request)) {
      ui.check(false, `refused ${name}`);
      return false;
    }
    ui.line(
      `◆ ${name} at ${request.address} (${request.link}) asks to link${enginePart(request.engine)}`
    );

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
