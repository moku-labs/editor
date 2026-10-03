import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("elkjs/lib/elk-worker.min.js");
});

describe("workerUrl", () => {
  it("wraps the worker script text in a Blob URL; revokeWorkerUrl revokes it", async () => {
    vi.doMock("elkjs/lib/elk-worker.min.js", () => ({ default: "self.onmessage = () => {};" }));
    const { revokeWorkerUrl, workerUrl } = await import("../../layout/worker-source");
    const url = await workerUrl();
    expect(url.startsWith("blob:")).toBe(true);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    revokeWorkerUrl(url);
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it("refuses a script that did not load as text", async () => {
    vi.doMock("elkjs/lib/elk-worker.min.js", () => ({ default: { not: "text" } }));
    const { workerUrl } = await import("../../layout/worker-source");
    await expect(workerUrl()).rejects.toThrow(
      "[moku-editor] The ELK worker script did not load as text."
    );
  });
});
