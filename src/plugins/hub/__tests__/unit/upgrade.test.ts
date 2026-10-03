/* eslint-disable sonarjs/no-clear-text-protocols -- the hub serves plain http on 127.0.0.1 */
import { describe, expect, it } from "vitest";
import { handleUpgrade } from "../../security/upgrade";
import type { FakeServer, TestCtx } from "../helpers";
import { createCtx, fakeServer, TOKEN } from "../helpers";

const P = 4000;

/** Options of one upgrade request. */
type Ask = {
  path?: string;
  token?: string | undefined;
  kind?: string | undefined;
  method?: string;
  headers?: Record<string, string | undefined>;
};

/**
 * Builds an upgrade request; every field defaults to a valid value.
 *
 * @param ask - What to change.
 * @returns The request.
 */
function upgradeRequest(ask: Ask = {}): Request {
  const url = new URL(`http://127.0.0.1:${P}${ask.path ?? "/__editor/ws"}`);
  const token = "token" in ask ? ask.token : TOKEN;
  const kind = "kind" in ask ? ask.kind : "tools";
  if (token !== undefined) url.searchParams.set("token", token);
  if (kind !== undefined) url.searchParams.set("kind", kind);

  const merged: Record<string, string | undefined> = {
    host: `127.0.0.1:${P}`,
    origin: `http://127.0.0.1:${P}`,
    upgrade: "websocket",
    connection: "Upgrade",
    ...ask.headers
  };
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) headers[key] = value;
  }
  return new Request(url, { method: ask.method ?? "GET", headers });
}

/**
 * A started ctx (token set) and a fake server.
 *
 * @param upgraded - What server.upgrade returns.
 * @returns The ctx and the server.
 */
function started(upgraded = true): { ctx: TestCtx; server: FakeServer } {
  const ctx = createCtx();
  ctx.state.token = TOKEN;
  return { ctx, server: fakeServer(P, upgraded) };
}

/**
 * The status of an upgrade attempt (101 when upgraded).
 *
 * @param ask - The request options.
 * @param upgraded - What server.upgrade returns.
 * @returns The status.
 */
function statusOf(ask: Ask = {}, upgraded = true): number {
  const { ctx, server } = started(upgraded);
  return handleUpgrade(ctx, upgradeRequest(ask), server)?.status ?? 101;
}

describe("handleUpgrade checks, in order", () => {
  it("answers 404 for any other path", () => {
    expect(statusOf({ path: "/__editor/other" })).toBe(404);
    expect(statusOf({ path: "/__editor/ws/x" })).toBe(404);
  });

  it("answers 503 before start / after stop (H17)", () => {
    const ctx = createCtx();

    expect(handleUpgrade(ctx, upgradeRequest(), fakeServer(P))?.status).toBe(503);
  });

  it("answers 426 without the websocket Upgrade header or for another method (H16)", () => {
    expect(statusOf({ headers: { upgrade: undefined } })).toBe(426);
    expect(statusOf({ headers: { upgrade: "h2c" } })).toBe(426);
    expect(statusOf({ method: "POST" })).toBe(426);
  });

  it("accepts the Upgrade header in any case", () => {
    expect(statusOf({ headers: { upgrade: "WebSocket" } })).toBe(101);
  });

  it("answers 403 on a guard failure, before the token check (H4, H5)", () => {
    expect(statusOf({ headers: { origin: "http://evil.com" }, token: "wrong" })).toBe(403);
    expect(statusOf({ headers: { origin: undefined } })).toBe(403);
  });

  it("answers 401 without token, with a wrong token of the same or another length (H1–H3)", () => {
    expect(statusOf({ token: undefined })).toBe(401);
    expect(statusOf({ token: "u".repeat(43) })).toBe(401);
    expect(statusOf({ token: "short" })).toBe(401);
  });

  it("answers 400 when kind is missing or unknown (H15)", () => {
    expect(statusOf({ kind: undefined })).toBe(400);
    expect(statusOf({ kind: "admin" })).toBe(400);
  });

  it("answers 400 when Bun refuses the upgrade", () => {
    expect(statusOf({}, false)).toBe(400);
  });

  it("upgrades with the kind and a fresh connection number", () => {
    const { ctx, server } = started();
    const first = ctx.state.nextConn;

    expect(handleUpgrade(ctx, upgradeRequest({ kind: "agent" }), server)).toBeUndefined();
    expect(handleUpgrade(ctx, upgradeRequest({ kind: "tools" }), server)).toBeUndefined();

    expect(server.upgrade).toHaveBeenNthCalledWith(1, expect.any(Request), {
      data: { kind: "agent", conn: first }
    });
    expect(server.upgrade).toHaveBeenNthCalledWith(2, expect.any(Request), {
      data: { kind: "tools", conn: first + 1 }
    });
    expect(ctx.state.nextConn).toBe(first + 2);
  });
});

describe("handleUpgrade refusals", () => {
  it("are plain, uncached, one word, and logged once with the check", async () => {
    const { ctx, server } = started();
    const refused = handleUpgrade(ctx, upgradeRequest({ token: "wrong" }), server);

    expect(refused?.status).toBe(401);
    expect(refused?.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(refused?.headers.get("cache-control")).toBe("no-store");
    expect(await refused?.text()).toMatch(/^\w+$/);
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("hub:refused", {
      status: 401,
      check: "token",
      host: `127.0.0.1:${P}`,
      origin: `http://127.0.0.1:${P}`
    });
  });

  it("logs the guard check name", () => {
    const { ctx, server } = started();
    handleUpgrade(ctx, upgradeRequest({ headers: { host: "evil.com" } }), server);

    expect(ctx.log.warn).toHaveBeenCalledWith(
      "hub:refused",
      expect.objectContaining({ status: 403, check: "host" })
    );
  });

  it("never logs the token or a URL with token= (H18)", () => {
    const { ctx, server } = started();
    const asks: Ask[] = [
      { token: undefined },
      { token: "x".repeat(43) },
      { token: "x" },
      { headers: { origin: "http://evil.com" } },
      { headers: { origin: undefined } },
      { headers: { origin: "null" } },
      { headers: { host: "evil.com:4000", origin: "http://evil.com:4000" } },
      { headers: { host: undefined } },
      { kind: "admin" },
      { kind: undefined },
      { headers: { upgrade: undefined } },
      { path: "/__editor/nope" },
      {}
    ];
    for (const ask of asks) handleUpgrade(ctx, upgradeRequest(ask), server);
    handleUpgrade(createCtx(), upgradeRequest(), server);

    const logged = JSON.stringify([
      ctx.log.warn.mock.calls,
      ctx.log.info.mock.calls,
      ctx.log.debug.mock.calls,
      ctx.log.error.mock.calls
    ]);
    expect(ctx.log.warn).toHaveBeenCalledTimes(asks.length - 1);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("token=");
  });
});
