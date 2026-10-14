import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubServer, RouteHandler } from "../../../hub/types";
import { createCollectorApi } from "../../api";
import { initCollector } from "../../init";
import { createLogSession } from "../../state";
import type { LogSession } from "../../types";
import type { TestCtx } from "../helpers";
import { createCtx, deviceOf, fileLines, LOG, removeDir, TOKEN, tempDir } from "../helpers";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

// ─────────────────────────────────────────────────────────────────────────────
// The computer mark: app.collector.mark and the {path}/perf/mark route, live
// logs only, on the log's page clock, behind the hub token.
// ─────────────────────────────────────────────────────────────────────────────

/** The computer clock of the tests. */
const NOW = 1_791_986_100_000;

/** The route's key under the hub path. */
const ROUTE = "/__editor/perf/mark";

/** A fake Bun server. */
const SERVER: HubServer = { port: 4000, upgrade: () => false };

let root: string;
let ctx: TestCtx;

/**
 * A log session in the temp folder, added to the state.
 *
 * @param name - Device id suffix and file name.
 * @param state - Its state.
 * @param offset - Its page-clock offset.
 * @returns The session.
 */
function sessionOf(name: string, state: LogSession["state"], offset: number): LogSession {
  const session = createLogSession({
    device: deviceOf({ id: `d-${name}` }),
    log: LOG,
    file: join(root, `${name}.jsonl`),
    model: "SM-A266B"
  });
  session.state = state;
  session.offset = offset;
  ctx.state.sessions.set(session.key, session);
  return session;
}

/**
 * The mark route registered by initCollector.
 *
 * @returns The handler.
 */
function route(): RouteHandler {
  initCollector(ctx);
  const handler = ctx.hub.routes.get(ROUTE);
  if (typeof handler !== "function") throw new Error("no mark route");
  return handler;
}

/**
 * Calls the route.
 *
 * @param init - The request's method, token and body.
 * @param init.method - The method (POST by default).
 * @param init.token - The bearer token (none by default).
 * @param init.body - The body.
 * @returns The response.
 */
async function call(init: { method?: string; token?: string; body?: string }): Promise<Response> {
  const headers: Record<string, string> =
    init.token === undefined ? {} : { authorization: `Bearer ${init.token}` };
  const method = init.method ?? "POST";
  const request: RequestInit =
    method === "POST" && init.body !== undefined
      ? { method, headers, body: init.body }
      : { method, headers };
  const response = await route()(new Request(`http://127.0.0.1:4000${ROUTE}`, request), SERVER);
  if (response === undefined) throw new Error("no response");
  return response;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(timingSafeEqual).mockClear();
  root = await tempDir();
  ctx = createCtx(root);
});

afterEach(async () => {
  vi.useRealTimers();
  await removeDir(root);
});

describe("collector.mark", () => {
  it("writes a trimmed computer mark into live logs only, on each log's page clock", async () => {
    const live = sessionOf("live", "live", 5917.4 - (NOW - 10_000));
    const away = sessionOf("away", "away", 0);

    const marked = await createCollectorApi(ctx).mark("  boss  ");
    await live.queue;

    expect(marked).toBe(1);
    expect(await fileLines(live.file)).toEqual([
      {
        v: 1,
        kind: "mark",
        t: 15_917.4,
        build: "debug-pair",
        rx: NOW,
        label: "boss",
        auto: false,
        from: "computer"
      }
    ]);
    expect(existsSync(away.file)).toBe(false);
  });

  it("refuses an empty or a 201-character label with a two-line TypeError", async () => {
    const api = createCollectorApi(ctx);

    await expect(api.mark("   ")).rejects.toThrow(TypeError);
    await expect(api.mark("x".repeat(201))).rejects.toThrow(
      '[moku-editor] collector.mark: the label must be 1-200 characters.\n  Give a short name, for example "boss".'
    );
    await expect(api.mark("x".repeat(200))).resolves.toBe(0);
  });
});

describe("the mark route", () => {
  it("is registered in onInit under the hub path", () => {
    route();

    expect(ctx.hub.addRoutes).toHaveBeenCalledTimes(1);
    expect([...ctx.hub.routes.keys()]).toEqual([ROUTE]);
  });

  it("answers 405 to another method and passes the guard's refusal through", async () => {
    const other = await call({ method: "GET", token: TOKEN });
    expect(other.status).toBe(405);

    ctx.hub.guard.mockReturnValue(new Response("forbidden", { status: 403 }));
    const refused = await call({ token: TOKEN, body: "boss" });
    expect(refused.status).toBe(403);
  });

  it("answers 401 without the hub token and compares it timing-safe", async () => {
    const missing = await call({ body: "boss" });
    const wrong = await call({ token: "x".repeat(43), body: "boss" });
    const short = await call({ token: "short", body: "boss" });

    expect([missing.status, wrong.status, short.status]).toEqual([401, 401, 401]);
    expect(await wrong.text()).toBe("unauthorized");
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it("answers 503 before start", async () => {
    ctx.hub.token.mockImplementation(() => {
      throw new Error("[moku-editor] hub.token() needs a started app.");
    });

    const early = await call({ token: TOKEN, body: "boss" });
    expect(early.status).toBe(503);
  });

  it("answers 400 label to an empty, a 201-character and a longer-than-4-KiB body", async () => {
    for (const body of ["  ", "y".repeat(201), "z".repeat(5000)]) {
      const response = await call({ token: TOKEN, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "label" });
    }
  });

  it("marks live logs and answers 200 with the count, no-store", async () => {
    const live = sessionOf("live", "live", 0);

    const response = await call({ token: TOKEN, body: "boss\n" });
    await live.queue;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ marked: 1 });
    const [mark] = await fileLines(live.file);
    expect(mark).toMatchObject({ label: "boss", from: "computer" });
  });

  it("answers {marked: 0} on a dev server without device mode, and creates no folder and no file", async () => {
    const response = await call({ token: TOKEN, body: "boss" });

    expect(await response.json()).toEqual({ marked: 0 });
    expect(existsSync(join(root, ".moku"))).toBe(false);
    expect(ctx.state.sessions.size).toBe(0);
  });
});
