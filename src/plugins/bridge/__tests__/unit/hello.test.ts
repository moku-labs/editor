/* eslint-disable sonarjs/no-clear-text-protocols, unicorn/no-null -- local test URLs and JSON null bodies */
import { describe, expect, it } from "vitest";
import { fetchHello, resolveHelloUrl, socketUrl } from "../../connection/hello";
import { fakeNet, helloOk, helloStatus } from "../helpers";

const PAGE = "http://127.0.0.1:3000/game.html";
const BODY = { ws: "/__editor/ws", token: "t1" };

describe("resolveHelloUrl", () => {
  it("resolves a same-origin path against the page URL", () => {
    expect(resolveHelloUrl("/__editor/hello", PAGE)?.href).toBe(
      "http://127.0.0.1:3000/__editor/hello"
    );
  });

  it("returns undefined for a relative path without a page URL", () => {
    expect(resolveHelloUrl("/__editor/hello", undefined)).toBeUndefined();
  });

  it("keeps an absolute URL with or without a page URL", () => {
    expect(resolveHelloUrl("http://127.0.0.1:4000/__editor/hello", undefined)?.href).toBe(
      "http://127.0.0.1:4000/__editor/hello"
    );
    expect(resolveHelloUrl("http://127.0.0.1:4000/__editor/hello", PAGE)?.origin).toBe(
      "http://127.0.0.1:4000"
    );
  });
});

describe("socketUrl", () => {
  const hello = new URL("http://127.0.0.1:3000/__editor/hello");

  it("turns http into ws and sets token and kind=agent", () => {
    expect(socketUrl(hello, BODY).href).toBe("ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent");
  });

  it("turns https into wss", () => {
    const secure = new URL("https://editor.local/__editor/hello");
    expect(socketUrl(secure, BODY).href).toBe("wss://editor.local/__editor/ws?token=t1&kind=agent");
  });

  it("resolves a relative ws against the hello URL", () => {
    expect(socketUrl(hello, { ws: "ws", token: "t1" }).href).toBe(
      "ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent"
    );
  });

  it("keeps an existing query and an absolute ws URL", () => {
    expect(socketUrl(hello, { ws: "/__editor/ws?v=2", token: "t1" }).search).toBe(
      "?v=2&token=t1&kind=agent"
    );
    expect(socketUrl(hello, { ws: "ws://127.0.0.1:4000/x", token: "t 2" }).href).toBe(
      "ws://127.0.0.1:4000/x?token=t+2&kind=agent"
    );
  });

  it("throws for a URL that is not a websocket URL", () => {
    expect(() => socketUrl(hello, { ws: "ftp://127.0.0.1/x", token: "t1" })).toThrow(
      "[moku-editor]"
    );
    expect(() => socketUrl(hello, { ws: "http://[bad", token: "t1" })).toThrow();
  });
});

describe("fetchHello", () => {
  const url = new URL("http://127.0.0.1:3000/__editor/hello");

  it("fetches without cache, same-origin, and returns the body", async () => {
    const net = fakeNet();

    await expect(fetchHello(net, url, undefined)).resolves.toEqual(BODY);
    expect(net.fetches).toEqual([
      { url: url.href, init: { cache: "no-store", credentials: "same-origin" } }
    ]);
  });

  it("sends the given headers", async () => {
    const net = fakeNet();

    await fetchHello(net, url, { origin: "http://127.0.0.1:3000" });

    expect(net.fetches[0]?.init.headers).toEqual({ origin: "http://127.0.0.1:3000" });
  });

  it("rejects with hello <status> on an HTTP error", async () => {
    const net = fakeNet();
    net.answers.push(helloStatus(404));

    await expect(fetchHello(net, url, undefined)).rejects.toThrow("[moku-editor] hello 404");
  });

  it("rejects with hello unreachable on a network error", async () => {
    const net = fakeNet();
    net.answers.push(new TypeError("fetch failed"));

    await expect(fetchHello(net, url, undefined)).rejects.toThrow(
      "[moku-editor] hello unreachable"
    );
  });

  it.each([
    ["no token", { ws: "/__editor/ws" }],
    ["an empty ws", { ws: "", token: "t1" }],
    ["a number token", { ws: "/x", token: 1 }],
    ["null", null],
    ["text", "ok"]
  ])("rejects a body with %s", async (_name, body) => {
    const net = fakeNet();
    net.answers.push(helloOk(body));

    await expect(fetchHello(net, url, undefined)).rejects.toThrow(
      "[moku-editor] hello answered without ws and token"
    );
  });

  it("rejects a body that is not JSON", async () => {
    const net = fakeNet();
    net.answers.push({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      }
    });

    await expect(fetchHello(net, url, undefined)).rejects.toThrow(
      "[moku-editor] hello answered without ws and token"
    );
  });

  it("returns only ws and token", async () => {
    const net = fakeNet();
    net.answers.push(helloOk({ ws: "/w", token: "t", extra: true }));

    await expect(fetchHello(net, url, undefined)).resolves.toEqual({ ws: "/w", token: "t" });
  });
});
