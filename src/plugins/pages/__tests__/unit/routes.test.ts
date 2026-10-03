/* eslint-disable sonarjs/no-clear-text-protocols -- loopback and foreign http origins are the cases under test */
import { rm } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorRoutes, RouteHandler } from "../../../hub/types";
import { createRoutes } from "../../routes";
import {
  bootJsonOf,
  createHarness,
  createPageDir,
  R3_CSP,
  request,
  SERVER,
  TOKEN
} from "../helpers";

const P = "/__editor";

/**
 * The handler of a route key.
 *
 * @param routes - The route map.
 * @param key - The route key.
 * @returns The handler.
 */
function handlerOf(routes: EditorRoutes, key: string): RouteHandler {
  const route = routes[key];
  if (typeof route !== "function") throw new Error(`no handler for ${key}`);
  return route;
}

/**
 * Calls a route with a request.
 *
 * @param routes - The route map.
 * @param key - The route key.
 * @param req - The request.
 * @returns The response.
 */
async function call(routes: EditorRoutes, key: string, req: Request): Promise<Response> {
  const response = await handlerOf(routes, key)(req, SERVER);
  if (!response) throw new Error("no response");
  return response;
}

let pageDir: string;

beforeEach(async () => {
  pageDir = await createPageDir();
});

afterEach(async () => {
  await rm(pageDir, { recursive: true, force: true });
});

describe("createRoutes", () => {
  it("returns the four frozen routes under the hub path", () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    expect(Object.keys(routes)).toEqual([P, `${P}/`, `${P}/hello`, `${P}/assets/*`]);
    expect(Object.isFrozen(routes)).toBe(true);
  });

  it("answers 405 with Allow on every route for other methods", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    for (const key of Object.keys(routes)) {
      const path = key.replace("*", "app-abc.js");
      const response = await call(routes, key, request(path, { method: "POST" }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("P5: no response carries Access-Control-Allow-Origin", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const requests: [string, Request][] = [
      [P, request(P)],
      [`${P}/`, request(`${P}/`)],
      [`${P}/hello`, request(`${P}/hello`)],
      [`${P}/hello`, request(`${P}/hello`, { headers: { origin: "http://evil.com" } })],
      [`${P}/assets/*`, request(`${P}/assets/app-abc.js`)],
      [`${P}/assets/*`, request(`${P}/assets/missing.js`)]
    ];
    for (const [key, req] of requests) {
      const response = await call(routes, key, req);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("redirect route (P)", () => {
  it("answers 308 to P/ and keeps the query", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(routes, P, request(`${P}?ws=flow&x=1`));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${P}/?ws=flow&x=1`);
  });

  it("is guarded (navigate)", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(routes, P, request(P, { headers: { host: "evil.com:4000" } }));
    expect(response.status).toBe(403);
  });
});

describe("page route (P/)", () => {
  it("serves the template with the boot JSON and the headers table", async () => {
    const { deps } = createHarness(pageDir);
    const routes = createRoutes(deps);
    const response = await call(routes, `${P}/`, request(`${P}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp.startsWith(R3_CSP)).toBe(true);
    expect(csp).toBe(`${R3_CSP}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    const boot = JSON.parse(bootJsonOf(await response.text()) ?? "{}");
    expect(boot.token).toBe(TOKEN);
    expect(boot.ws).toBe("ws://127.0.0.1:4000/__editor/ws");
  });

  it("reads the template once and caches it in state", async () => {
    const { deps, state } = createHarness(pageDir);
    const routes = createRoutes(deps);
    await call(routes, `${P}/`, request(`${P}/`));
    expect(state.template).toContain("<title>");
    await rm(pageDir, { recursive: true, force: true });
    const again = await call(routes, `${P}/`, request(`${P}/`));
    expect(again.status).toBe(200);
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(routes, `${P}/`, request(`${P}/`, { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.text()).toBe("");
  });

  it("answers 503 and logs pages:not-built once when not built", async () => {
    const { deps, log } = createHarness(undefined);
    const routes = createRoutes(deps);
    const first = await call(routes, `${P}/`, request(`${P}/`));
    const second = await call(routes, `${P}/`, request(`${P}/`));
    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(await first.text()).toBe("tools page not built · run bun run build:tools");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("pages:not-built", { pageDir: undefined });
  });

  it("answers 503 when index.html is missing from the folder", async () => {
    const empty = await createPageDir();
    await rm(join(empty, "index.html"));
    const { deps, log } = createHarness(empty);
    const response = await call(createRoutes(deps), `${P}/`, request(`${P}/`));
    expect(response.status).toBe(503);
    expect(log.error).toHaveBeenCalledWith("pages:not-built", { pageDir: empty });
    await rm(empty, { recursive: true, force: true });
  });

  it("answers 503 for a template without </head>", async () => {
    const broken = await createPageDir("<html><body></body></html>");
    const response = await call(
      createRoutes(createHarness(broken).deps),
      `${P}/`,
      request(`${P}/`)
    );
    expect(response.status).toBe(503);
    await rm(broken, { recursive: true, force: true });
  });

  it("answers 503 before start / after stop (no token)", async () => {
    const { deps, hub } = createHarness(pageDir);
    hub.started = false;
    const response = await call(createRoutes(deps), `${P}/`, request(`${P}/`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(TOKEN);
  });

  it("P1: Host evil.com (DNS rebinding) gets 403 and no token", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/`,
      request(`${P}/`, { headers: { host: "evil.com:4000" } })
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe("hello route (P/hello)", () => {
  it("P4: same-origin GET answers { ws, token } as JSON, never cached", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/hello`,
      request(`${P}/hello`, {
        headers: { origin: "http://127.0.0.1:4000", "sec-fetch-site": "same-origin" }
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ws: "ws://127.0.0.1:4000/__editor/ws", token: TOKEN });
  });

  it("P2: a foreign Origin gets 403", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/hello`,
      request(`${P}/hello`, { headers: { origin: "http://evil.com" } })
    );
    expect(response.status).toBe(403);
  });

  it("P3: Sec-Fetch-Site cross-site without Origin gets 403", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/hello`,
      request(`${P}/hello`, { headers: { "sec-fetch-site": "cross-site" } })
    );
    expect(response.status).toBe(403);
  });

  it("answers HEAD without a body and 503 before start", async () => {
    const { deps, hub } = createHarness(pageDir);
    const routes = createRoutes(deps);
    const head = await call(routes, `${P}/hello`, request(`${P}/hello`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    hub.started = false;
    const stopped = await call(routes, `${P}/hello`, request(`${P}/hello`));
    expect(stopped.status).toBe(503);
  });
});

describe("asset route (P/assets/*)", () => {
  it("serves a built asset with type and immutable cache headers", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(routes, `${P}/assets/*`, request(`${P}/assets/app-abc.js`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("console.log(1);");
  });

  it("serves nested names and a .woff2 as font/woff2", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const nested = await call(routes, `${P}/assets/*`, request(`${P}/assets/nested/a.js`));
    expect(nested.status).toBe(200);
    const font = await call(routes, `${P}/assets/*`, request(`${P}/assets/Geist-1a2b.woff2`));
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(new Uint8Array(await font.arrayBuffer())).toEqual(
      new Uint8Array([0x77, 0x4f, 0x46, 0x32])
    );
  });

  it("answers HEAD without a body", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/assets/*`,
      request(`${P}/assets/app-abc.js`, { method: "HEAD" })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("P10: refuses traversal, dotfiles, NUL, folders and missing files with 404", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const names = [
      "../index.html",
      "%2e%2e/index.html",
      "a/../../x",
      "nested/%2e%2e/%2e%2e/index.html",
      "nested%2f..%2f..%2findex.html",
      ".hidden",
      "a%00.js",
      "nested",
      "missing.js",
      "",
      "a%5cb.js"
    ];
    for (const name of names) {
      const response = await call(routes, `${P}/assets/*`, request(`${P}/assets/${name}`));
      expect(response.status, name).toBe(404);
    }
  });

  it("answers 400 for a malformed escape", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(routes, `${P}/assets/*`, request(`${P}/assets/%E0%A4%A`));
    expect(response.status).toBe(400);
  });

  it("answers 404 when the page is not built", async () => {
    const routes = createRoutes(createHarness(undefined).deps);
    const response = await call(routes, `${P}/assets/*`, request(`${P}/assets/app-abc.js`));
    expect(response.status).toBe(404);
  });

  it("is guarded (navigate)", async () => {
    const routes = createRoutes(createHarness(pageDir).deps);
    const response = await call(
      routes,
      `${P}/assets/*`,
      request(`${P}/assets/app-abc.js`, { headers: { origin: "http://evil.com" } })
    );
    expect(response.status).toBe(403);
  });
});
