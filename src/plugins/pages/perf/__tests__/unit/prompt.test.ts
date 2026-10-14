/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { describe, expect, it, vi } from "vitest";
import type { PairRequest } from "../../../../hub/types";
import { pairPrompt } from "../../prompt";
import type { PerfDeps } from "../../types";
import { recordingConsole } from "../helpers";

/** A LAN phone asking to link. */
const REQUEST: PairRequest = {
  code: "4821",
  model: "SM-A266B",
  address: "192.168.1.23",
  link: "lan",
  engine: "0.14.12+9c41e0",
  build: null
};

/** The question of the prompt. */
const QUESTION = "  Type the 4-digit code on its screen (Enter refuses): ";

/**
 * Runs the prompt once with an `ask` that answers or throws.
 *
 * @param ask - The terminal seam.
 * @param signal - The pairing's signal.
 * @returns The answer and the printed lines.
 */
async function confirmWith(ask: PerfDeps["ask"], signal = new AbortController().signal) {
  const { ui, lines } = recordingConsole();
  const answer = await pairPrompt(ui, ask)(REQUEST, signal);
  return { answer, lines };
}

describe("pairPrompt", () => {
  it("names the phone, asks for the 4-digit code with the pairing's signal, and links on the typed code", async () => {
    const ask = vi.fn<PerfDeps["ask"]>(() => Promise.resolve(" 4821 \n"));
    const signal = new AbortController().signal;
    const { answer, lines } = await confirmWith(ask, signal);
    expect(answer).toBe(true);
    expect(ask).toHaveBeenCalledWith(QUESTION, signal);
    expect(lines).toEqual([
      "◆ SM-A266B at 192.168.1.23 (lan) asks to link · engine 0.14.12+9c41e0",
      "  ✓ linked SM-A266B"
    ]);
  });

  it("refuses another code and an empty Enter: a stranger's phone never links by a y", async () => {
    for (const typed of ["1234", "", "y"]) {
      const { answer, lines } = await confirmWith(() => Promise.resolve(typed));
      expect(answer).toBe(false);
      expect(lines.at(-1)).toBe("  ✗ refused SM-A266B");
    }
  });

  it("answers false with a note when the signal aborted the question", async () => {
    const abort = new AbortController();
    abort.abort();
    const { answer, lines } = await confirmWith(
      () => Promise.reject(new Error("The operation was aborted")),
      abort.signal
    );
    expect(answer).toBe(false);
    expect(lines.at(-1)).toBe("  (the phone left or the wait ran out)");
  });

  it("answers false when ask throws for another reason", async () => {
    const { answer, lines } = await confirmWith(() => Promise.reject(new Error("stdin closed")));
    expect(answer).toBe(false);
    expect(lines.at(-1)).toBe("  ✗ refused SM-A266B");
  });

  it("names a phone without a model and leaves an unknown engine out", async () => {
    const { ui, lines } = recordingConsole();
    await pairPrompt(ui, () => Promise.resolve("4821"))(
      { ...REQUEST, model: null, engine: null },
      new AbortController().signal
    );
    expect(lines[0]).toBe("◆ A phone at 192.168.1.23 (lan) asks to link");
  });
});

describe("the one input seam", () => {
  it("reads the terminal through node:readline only in deps.ts, whose comment cites the decision", () => {
    const folder = join(import.meta.dirname, "../..");
    const sources = readdirSync(folder).filter(name => name.endsWith(".ts"));
    const readers = sources.filter(name =>
      readFileSync(join(folder, name), "utf8").includes("node:readline")
    );
    expect(readers).toEqual(["deps.ts"]);
    expect(readFileSync(join(folder, "deps.ts"), "utf8")).toContain(
      'decisions.md "Pairing code prompt uses node:readline behind one ask seam"'
    );
  });
});

/**
 * The ask line the prompt prints for a phone reporting an engine.
 *
 * @param engine - The engine text the phone sent.
 * @returns The first printed line.
 */
async function shown(engine: string): Promise<string | undefined> {
  const { ui, lines } = recordingConsole();
  await pairPrompt(ui, () => Promise.resolve(""))(
    { ...REQUEST, engine },
    new AbortController().signal
  );
  return lines[0];
}

describe("pairPrompt hardening (W4)", () => {
  it("refuses at once a phone whose model, engine or build shows the code, without asking", async () => {
    const leaks: readonly Partial<PairRequest>[] = [
      { model: "SM-4821" },
      { engine: "4821" },
      { build: "debug-4821" }
    ];
    for (const leak of leaks) {
      const ask = vi.fn<PerfDeps["ask"]>(() => Promise.resolve("4821"));
      const { ui, lines } = recordingConsole();
      const request = { ...REQUEST, ...leak };
      expect(await pairPrompt(ui, ask)(request, new AbortController().signal)).toBe(false);
      expect(ask).not.toHaveBeenCalled();
      expect(lines).toEqual([`  ✗ refused ${request.model}`]);
    }
  });

  it("prints the engine only when it looks like an engine id or is unknown", async () => {
    expect(await shown("0.14.12")).toBe(
      "◆ SM-A266B at 192.168.1.23 (lan) asks to link · engine 0.14.12"
    );
    expect(await shown("unknown")).toBe(
      "◆ SM-A266B at 192.168.1.23 (lan) asks to link · engine unknown"
    );
    expect(await shown("type 1234 now")).toBe("◆ SM-A266B at 192.168.1.23 (lan) asks to link");
    expect(await shown("0.14.12+9C41E0")).toBe("◆ SM-A266B at 192.168.1.23 (lan) asks to link");
  });
});
