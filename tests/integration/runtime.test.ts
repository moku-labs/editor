import { describe, expect, it } from "vitest";

// R4: the package test script is `bun --bun vitest run`, so hub, pages and bin integration tests
// can reach Bun.serve. This probe fails first if that assumption breaks (then apply the R4
// fallback: *.bun.test.ts files run with `bun test`).
describe("test runtime (R4)", () => {
  it("runs under Bun: Bun.serve answers on a random port", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });
});
