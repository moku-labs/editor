/* eslint-disable sonarjs/no-clear-text-protocols -- loopback and foreign http origins are the cases under test */
import { describe, expect, it, vi } from "vitest";
import type { BunServeOptions, RouteHandler } from "../../../hub/types";
import { attachServer, hmrOf, hotReloadOf, hotReloadRoute, setHotReload } from "../../hot-reload";
import { createHarness, request, SERVER, TOKEN } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// pages hot reload (R6, D-23, D-32): the bin attaches its server, the state is
// published through the hub, and P/hmr answers GET and guarded POST. A change
// restarts the bin's server with HMR flipped (A1): the asked state is set and
// published at once, the restart runs after the answer. Without the bin's
// restart a change is refused (Bun cannot switch HMR on a running server).
// ─────────────────────────────────────────────────────────────────────────────

const P = "/__editor";

/** Serve options with a development value, as the bin passes them. */
function optionsWith(development: unknown): BunServeOptions {
  return { development } as unknown as BunServeOptions;
}

/** The options the bin serves with: a port and Bun HMR on with console forwarding. */
const BIN_OPTIONS = { port: 4000, development: { hmr: true, console: true } };

/**
 * A harness whose bin attached its server with HMR on and its restart.
 *
 * @returns The harness and the restart mock.
 */
function switchable() {
  const harness = createHarness(undefined);
  const restart = vi.fn((_options: BunServeOptions) => Promise.resolve());
  attachServer(harness.deps, BIN_OPTIONS as unknown as BunServeOptions, restart);
  harness.hub.publish.mockClear();
  harness.log.info.mockClear();
  return { harness, restart };
}

/**
 * Lets the restart scheduled on the next macrotask run, with its promise callbacks.
 */
async function afterRestart(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A harness whose bin attached its server with HMR on, without a restart. */
function attached() {
  const harness = createHarness(undefined);
  attachServer(harness.deps, optionsWith({ hmr: true, console: true }));
  harness.hub.publish.mockClear();
  return harness;
}

/**
 * Calls the P/hmr route.
 *
 * @param route - The route handler.
 * @param req - The request.
 * @returns The response.
 */
async function call(route: RouteHandler, req: Request): Promise<Response> {
  const response = await route(req, SERVER);
  if (!response) throw new Error("no response");
  return response;
}

/**
 * A POST to P/hmr with the boot token and a JSON body.
 *
 * @param body - The body text.
 * @param token - The bearer token (default the hub's), or false for no Authorization header.
 * @returns The request.
 */
function post(body: string, token: string | false = TOKEN): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== false) headers.authorization = `Bearer ${token}`;
  return request(`${P}/hmr`, { method: "POST", headers, body });
}

describe("hmrOf", () => {
  it("reads development the way Bun does for the bin's options", () => {
    expect(hmrOf(true)).toBe(true);
    expect(hmrOf({ hmr: true, console: true })).toBe(true);
    expect(hmrOf({ console: true })).toBe(true);
    expect(hmrOf({ hmr: false })).toBe(false);
    expect(hmrOf(false)).toBe(false);
    expect(hmrOf(undefined)).toBe(false);
  });
});

describe("hot reload state", () => {
  it("is owner server with HMR off until the bin attaches its server", () => {
    const { state } = createHarness(undefined);
    expect(hotReloadOf(state)).toEqual({ hmr: false, owner: "server" });
  });

  it("attachServer makes the bin the owner, reads HMR and publishes it", () => {
    const harness = createHarness(undefined);
    attachServer(harness.deps, optionsWith({ hmr: true, console: true }));

    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", { hmr: true, owner: "bin" });
  });

  it("hotReloadOf returns a copy", () => {
    const harness = attached();
    const first = hotReloadOf(harness.state);
    Reflect.set(first, "hmr", false);
    expect(hotReloadOf(harness.state).hmr).toBe(true);
  });
});

describe("setHotReload", () => {
  it("answers false for a game's own server and publishes the unchanged state", async () => {
    const harness = createHarness(undefined);
    await expect(setHotReload(harness.deps, true)).resolves.toBe(false);
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", {
      hmr: false,
      owner: "server"
    });
  });

  it("answers true for the bin when HMR already has the asked value", async () => {
    const harness = attached();
    await expect(setHotReload(harness.deps, true)).resolves.toBe(true);
    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
    expect(harness.hub.publish).toHaveBeenCalledTimes(1);
  });

  it("answers false for a change without the bin's restart, logs it and keeps the state", async () => {
    const harness = attached();
    await expect(setHotReload(harness.deps, false)).resolves.toBe(false);
    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
    expect(harness.log.info).toHaveBeenCalledWith("pages:hot-reload-read-only", { hmr: true });
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", { hmr: true, owner: "bin" });
  });
});

describe("setHotReload with the bin's restart (D-32, A1)", () => {
  it("answers true at once, publishes the asked state and restarts after the answer", async () => {
    const { harness, restart } = switchable();

    await expect(setHotReload(harness.deps, false)).resolves.toBe(true);
    expect(hotReloadOf(harness.state)).toEqual({ hmr: false, owner: "bin" });
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", { hmr: false, owner: "bin" });
    expect(restart).not.toHaveBeenCalled();

    await afterRestart();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledWith({
      port: 4000,
      development: { hmr: false, console: true }
    });
    expect(harness.log.info).toHaveBeenCalledWith("pages:hot-reload-switched", { hmr: false });
  });

  it("a second change restarts from the switched options", async () => {
    const { harness, restart } = switchable();
    await setHotReload(harness.deps, false);
    await afterRestart();

    await expect(setHotReload(harness.deps, true)).resolves.toBe(true);
    await afterRestart();
    expect(restart).toHaveBeenLastCalledWith({
      port: 4000,
      development: { hmr: true, console: true }
    });
    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
  });

  it("the value it already has answers true without a restart", async () => {
    const { harness, restart } = switchable();
    await expect(setHotReload(harness.deps, true)).resolves.toBe(true);
    await afterRestart();
    expect(restart).not.toHaveBeenCalled();
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", { hmr: true, owner: "bin" });
  });

  it("switches a boolean development option to an object with hmr", async () => {
    const harness = createHarness(undefined);
    const restart = vi.fn((_options: BunServeOptions) => Promise.resolve());
    attachServer(harness.deps, optionsWith(true), restart);

    await setHotReload(harness.deps, false);
    await afterRestart();
    expect(restart).toHaveBeenCalledWith({ development: { hmr: false } });
  });

  it("a failed restart is logged, reverts and publishes the state, and serves the old options again", async () => {
    const { harness, restart } = switchable();
    restart.mockRejectedValueOnce(new Error("port 4000 is in use"));

    await expect(setHotReload(harness.deps, false)).resolves.toBe(true);
    await afterRestart();

    expect(harness.log.error).toHaveBeenCalledWith("pages:hot-reload-restart-failed", {
      hmr: false,
      message: "port 4000 is in use"
    });
    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
    expect(harness.hub.publish).toHaveBeenLastCalledWith("hotReload", { hmr: true, owner: "bin" });
    expect(restart).toHaveBeenCalledTimes(2);
    expect(restart).toHaveBeenLastCalledWith(BIN_OPTIONS);
    expect(harness.log.info).not.toHaveBeenCalledWith("pages:hot-reload-switched", {
      hmr: false
    });
  });

  it("a failed second serve is logged too", async () => {
    const { harness, restart } = switchable();
    restart.mockRejectedValueOnce(new Error("in use")).mockRejectedValueOnce("gone");

    await setHotReload(harness.deps, false);
    await afterRestart();

    expect(harness.log.error).toHaveBeenCalledWith("pages:hot-reload-serve-again-failed", {
      hmr: true,
      message: "gone"
    });
    expect(hotReloadOf(harness.state)).toEqual({ hmr: true, owner: "bin" });
  });

  it("a game's own server still answers false and never restarts", async () => {
    const harness = createHarness(undefined);
    await expect(setHotReload(harness.deps, true)).resolves.toBe(false);
    expect(hotReloadOf(harness.state)).toEqual({ hmr: false, owner: "server" });
  });
});

describe("P/hmr route", () => {
  it("GET answers the state as JSON, never cached, without CORS", async () => {
    const harness = attached();
    const response = await call(hotReloadRoute(harness.deps), request(`${P}/hmr`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({ hmr: true, owner: "bin" });
  });

  it("HEAD keeps the headers and drops the body", async () => {
    const harness = attached();
    const response = await call(
      hotReloadRoute(harness.deps),
      request(`${P}/hmr`, { method: "HEAD" })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("is guarded same-origin: a cross-site GET or POST gets 403", async () => {
    const route = hotReloadRoute(attached().deps);
    const foreign = { origin: "http://evil.com" };
    const get = await call(route, request(`${P}/hmr`, { headers: foreign }));
    const posted = await call(
      route,
      request(`${P}/hmr`, {
        method: "POST",
        headers: { ...foreign, authorization: `Bearer ${TOKEN}` },
        body: '{"hmr":false}'
      })
    );
    expect(get.status).toBe(403);
    expect(posted.status).toBe(403);
  });

  it("POST without the boot token, or with another, answers 401", async () => {
    const harness = attached();
    const route = hotReloadRoute(harness.deps);
    const noScheme = request(`${P}/hmr`, {
      method: "POST",
      headers: { authorization: TOKEN },
      body: '{"hmr":true}'
    });
    await expect(call(route, post('{"hmr":true}', false))).resolves.toHaveProperty("status", 401);
    await expect(call(route, post('{"hmr":true}', "x".repeat(43)))).resolves.toHaveProperty(
      "status",
      401
    );
    await expect(call(route, noScheme)).resolves.toHaveProperty("status", 401);
    expect(harness.hub.publish).not.toHaveBeenCalled();
  });

  it("POST with a body that is not { hmr: boolean } answers 400", async () => {
    const route = hotReloadRoute(attached().deps);
    for (const body of [
      "",
      "{nope",
      '{"hmr":"yes"}',
      "[]",
      "null",
      `{"hmr":true,"x":"${"a".repeat(2000)}"}`
    ]) {
      await expect(call(route, post(body))).resolves.toHaveProperty("status", 400);
    }
  });

  it("POST answers 200 with the unchanged state for a game's own server", async () => {
    const harness = createHarness(undefined);
    const response = await call(hotReloadRoute(harness.deps), post('{"hmr":true}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hmr: false, owner: "server" });
  });

  it("POST answers 200 with the state for the same value and for a refused change", async () => {
    const route = hotReloadRoute(attached().deps);
    const same = await call(route, post('{"hmr":true}'));
    const change = await call(route, post('{"hmr":false}'));
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ hmr: true, owner: "bin" });
    expect(change.status).toBe(200);
    expect(await change.json()).toEqual({ hmr: true, owner: "bin" });
  });

  it("POST answers 200 with the asked state when the bin can restart its server", async () => {
    const { harness, restart } = switchable();
    const response = await call(hotReloadRoute(harness.deps), post('{"hmr":false}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hmr: false, owner: "bin" });
    await afterRestart();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("POST answers 503 before start (no token)", async () => {
    const harness = attached();
    harness.hub.started = false;
    const response = await call(hotReloadRoute(harness.deps), post('{"hmr":true}'));
    expect(response.status).toBe(503);
  });

  it("answers 405 with Allow GET, HEAD, POST for another method", async () => {
    const route = hotReloadRoute(attached().deps);
    const response = await call(route, request(`${P}/hmr`, { method: "PUT" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
  });
});
