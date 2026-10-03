// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { createLazyEngine, createWorkerEngine } from "../../layout/engine";
import type { LayoutEngine } from "../../layout/types";
import { createTestCtx, jumpCamera, prepare } from "../ctx";

vi.mock("../../layout/worker-source", () => ({
  workerUrl: vi.fn(async () => "blob:test"),
  revokeWorkerUrl: vi.fn()
}));

/** Workers created. */
let created = 0;

/** A worker that answers the ELK worker protocol with a grid placement. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | undefined;
  terminated = false;

  constructor() {
    created += 1;
  }

  postMessage(message: {
    id: number;
    cmd: string;
    graph?: { children?: { x?: number; y?: number }[] };
  }): void {
    setTimeout(() => {
      const graph = message.graph;
      for (const [index, child] of (graph?.children ?? []).entries()) {
        child.x = index * 200;
        child.y = 0;
      }
      this.onmessage?.({ data: { id: message.id, data: graph } });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWorkerEngine", () => {
  it("lays out in the worker; dispose terminates it and revokes once", async () => {
    let worker: FakeWorker | undefined;
    const revoke = vi.fn();
    const engine = createWorkerEngine(() => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    }, revoke);
    const out = await engine.layout({ id: "root", children: [{ id: "a" }, { id: "b" }] });
    expect(out.children?.map(child => child.x)).toEqual([0, 200]);
    engine.dispose();
    engine.dispose();
    expect(worker?.terminated).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe("createLazyEngine", () => {
  it("creates the real engine once, on the first layout", async () => {
    const real: LayoutEngine = { layout: vi.fn(async input => input), dispose: vi.fn() };
    const create = vi.fn(async () => real);
    const lazy = createLazyEngine(create);
    lazy.dispose();
    expect(create).not.toHaveBeenCalled();
    await lazy.layout({ id: "a" });
    await lazy.layout({ id: "b" });
    expect(create).toHaveBeenCalledTimes(1);
    lazy.dispose();
    await Promise.resolve();
    expect(real.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("engine choice", () => {
  it("uses a Blob worker when layoutWorker is on", async () => {
    jumpCamera();
    created = 0;
    vi.stubGlobal("Worker", FakeWorker);
    const { ctx } = createTestCtx({ config: { layoutWorker: true } });
    await prepare(ctx);
    expect(created).toBe(1);
    expect(ctx.state.layout.result?.byKey["main/home"]).toBeDefined();
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("falls back to the inline engine with one warning when the worker cannot start", async () => {
    jumpCamera();
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by CSP");
        }
      }
    );
    const { ctx } = createTestCtx({ config: { layoutWorker: true } });
    await prepare(ctx);
    expect(ctx.state.layout.result?.byKey["main/home"]).toBeDefined();
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    actionsOf(ctx).layout.pinnedCount();
  });
});
