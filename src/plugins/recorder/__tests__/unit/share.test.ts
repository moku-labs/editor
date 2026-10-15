// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import { flushTick } from "../../flush";
import type { TestRecorder } from "../helpers";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// share: the native share sheet when the shell has one, else a download link,
// else an error; the current log written first; the status exporting and back.
// ─────────────────────────────────────────────────────────────────────────────

let t: TestRecorder;
let name: string;

beforeEach(() => {
  vi.useFakeTimers();
  t = recorder();
  name = t.api.start().name;
  t.monitor.emit(sampleLine(7));
  flushTick(t.ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * A native shell whose share answers `answer`.
 *
 * @param answer - What share resolves with, or an Error it rejects with.
 * @param version - The shell's version.
 * @returns The share mock.
 */
function nativeShell(answer: { shared: boolean } | Error, version = 1) {
  const share = vi.fn(async (_file: { name: string; mime: string; bytes: Uint8Array }) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  vi.stubGlobal("__MOKU_NATIVE__", { version, share });
  return share;
}

describe("share", () => {
  it("hands the shell the name, the ndjson mime and the exact bytes, the current log written first", async () => {
    const share = nativeShell({ shared: true });
    await expect(t.api.share(name)).resolves.toBe("shared");
    const file = share.mock.calls[0]?.[0];
    expect([file?.name, file?.mime]).toEqual([name, "application/x-ndjson"]);
    const text = new TextDecoder().decode(file?.bytes);
    expect(text.split("\n").map(line => (line === "" ? "" : JSON.parse(line).kind))).toEqual([
      "header",
      "event",
      "sample",
      ""
    ]);
    expect(t.log.info).toHaveBeenCalledWith("recorder:shared", { file: name, how: "shared" });
  });

  it("answers cancelled when the shell's sheet was dismissed", async () => {
    nativeShell({ shared: false });
    await expect(t.api.share(name)).resolves.toBe("cancelled");
  });

  it.each([
    ["a shell of version 2", { version: 2, share: vi.fn() }],
    ["a shell without share", { version: 1 }]
  ])("falls back to a clicked download link with %s, the URL revoked later", async (_label, shell) => {
    vi.stubGlobal("__MOKU_NATIVE__", shell);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:perf-log");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    await expect(t.api.share(name)).resolves.toBe("downloaded");
    expect(clicked.map(anchor => [anchor.download, anchor.href])).toEqual([
      [name, "blob:perf-log"]
    ]);
    expect(await (create.mock.calls[0]?.[0] as Blob).text()).toContain('"kind":"sample"');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith("blob:perf-log");
  });

  it("throws the two-line Error on a page with neither a document nor a native share", async () => {
    vi.stubGlobal("document", undefined);
    await expect(t.api.share(name)).rejects.toThrow(
      "[moku-editor] recorder.share needs a page with a document or a native shell with share().\n  Share the log from a browser page or a native build."
    );
  });

  it("throws a two-line TypeError for an unknown name (bug: a share of a missing log answering downloaded)", async () => {
    nativeShell({ shared: true });
    const share = t.api.share("perf-20261014-0000-nope.jsonl");
    await expect(share).rejects.toThrow(TypeError);
    await expect(share).rejects.toThrow(
      '[moku-editor] recorder.share: no log named "perf-20261014-0000-nope.jsonl".\n  Pick a name from recorder.files().'
    );
  });

  it("writes a recorder export event and shows exporting, then the phase before, also when the shell rejects", async () => {
    nativeShell(new Error("sheet failed"));
    t.emit.mockClear();
    await expect(t.api.share(name)).rejects.toThrow("sheet failed");
    expect(t.monitor.events.at(-1)).toEqual({ name: "recorder", detail: { action: "export" } });
    expect(t.emit.mock.calls.map(([, event]) => event.state)).toEqual(["exporting", "recording"]);
    expect(t.api.status().state).toBe("recording");
  });
});
