/* eslint-disable sonarjs/no-clear-text-protocols -- loopback and foreign http origins are the cases under test */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../../server";
import type { ToolsBoot } from "../../../registry/protocol";
import { bootJsonOf, createPageDir, R3_CSP, rawGet } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The real server core (files, hub, pages) on Bun.serve port 0, with a fixture
// page folder: redirect, page + boot, websocket with the boot token, hello
// guard, assets, and the 503 after stop.
// ─────────────────────────────────────────────────────────────────────────────

let base: string;
let pageDir: string;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof Bun.serve>;
let origin: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moku-pages-it-")));
  pageDir = await createPageDir();
  app = createApp({
    pluginConfigs: {
      files: { root: base },
      pages: { pageDir, title: "merge game" }
    }
  });
  app.log.clearSinks();
  await app.start();
  server = Bun.serve(app.hub.serve({ port: 0 }));
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await app.stop().catch(() => undefined);
  await Promise.race([server.stop(true), Bun.sleep(300)]);
  await rm(base, { recursive: true, force: true });
  await rm(pageDir, { recursive: true, force: true });
});

/**
 * Opens a tools websocket and resolves with the first message on channel editor.
 *
 * @param url - The socket URL with token and kind.
 * @returns The first message text.
 */
function firstEditorMessage(url: string): Promise<string> {
  const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers: { origin } }]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message")), 3000);
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string" || !event.data.includes('"editor"')) return;
      clearTimeout(timer);
      socket.close();
      resolve(event.data);
    });
    socket.addEventListener("error", () => reject(new Error("socket failed")));
  });
}

describe("pages integration", () => {
  it("registers the five routes with the hub", () => {
    expect(Object.keys(app.pages.routes())).toEqual([
      "/__editor",
      "/__editor/",
      "/__editor/hello",
      "/__editor/hmr",
      "/__editor/assets/*"
    ]);
  });

  it("redirects GET P to P/", async () => {
    const response = await fetch(`${origin}/__editor?x=1`, { redirect: "manual" });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/__editor/?x=1");
  });

  it("serves the page with a live ToolsBoot and the R3 policy", async () => {
    const response = await fetch(`${origin}/__editor/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")?.startsWith(R3_CSP)).toBe(true);
    const html = await response.text();
    expect(html).toContain("<title>merge game</title>");
    const boot: ToolsBoot = JSON.parse(bootJsonOf(html) ?? "{}");
    expect(boot).toEqual({
      v: 1,
      ws: `ws://127.0.0.1:${server.port}/__editor/ws`,
      token: app.hub.token(),
      path: "/__editor",
      title: "merge game",
      editorUrl: "vscode://file/{path}:{line}",
      root: base,
      gameUrl: "/"
    });
  });

  it("opens a tools socket with the boot token and receives sessions on channel editor", async () => {
    const html = await fetch(`${origin}/__editor/`).then(response => response.text());
    const boot: ToolsBoot = JSON.parse(bootJsonOf(html) ?? "{}");
    const message = JSON.parse(
      await firstEditorMessage(`${boot.ws}?token=${boot.token}&kind=tools`)
    );
    expect(message).toMatchObject({ channel: "editor", method: "sessions" });
  });

  it("P4/P2/P3/P1: hello answers same-origin only", async () => {
    const same = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({
      ws: `ws://127.0.0.1:${server.port}/__editor/ws`,
      token: app.hub.token()
    });
    const foreign = await fetch(`${origin}/__editor/hello`, {
      headers: { origin: "http://evil.com" }
    });
    expect(foreign.status).toBe(403);
    const crossSite = await fetch(`${origin}/__editor/hello`, {
      headers: { "sec-fetch-site": "cross-site" }
    });
    expect(crossSite.status).toBe(403);
    const port = server.port ?? 0;
    await expect(rawGet(port, "/__editor/hello", `evil.com:${port}`)).resolves.toHaveProperty(
      "status",
      403
    );
    const page = await rawGet(port, "/__editor/", `evil.com:${port}`);
    expect(page.status).toBe(403);
    expect(page.text).not.toContain(app.hub.token());
  });

  it("serves an asset with its type and cache headers", async () => {
    const response = await fetch(`${origin}/__editor/assets/index-abc.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("hot reload: owner server until attachServer, then the bin's state on GET, POST and the socket", async () => {
    await expect(fetch(`${origin}/__editor/hmr`).then(r => r.json())).resolves.toEqual({
      hmr: false,
      owner: "server"
    });

    app.pages.attachServer(server, { development: { hmr: true, console: true } } as never);
    const html = await fetch(`${origin}/__editor/`).then(response => response.text());
    const boot: ToolsBoot = JSON.parse(bootJsonOf(html) ?? "{}");
    const url = `${boot.ws}?token=${boot.token}&kind=tools`;
    const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers: { origin } }]);
    const methods = await new Promise<string[]>((resolve, reject) => {
      const seen: string[] = [];
      const timer = setTimeout(() => reject(new Error(`only ${seen.join(",")}`)), 3000);
      socket.addEventListener("message", event => {
        seen.push(JSON.parse(String(event.data)).method);
        if (seen.length < 2) return;
        clearTimeout(timer);
        socket.close();
        resolve(seen);
      });
    });
    expect(methods).toEqual(["sessions", "hotReload"]);

    /**
     * POSTs a hot reload change.
     *
     * @param hmr - The asked value.
     * @param token - The Bearer token, or undefined for none.
     * @returns The response.
     */
    const post = (hmr: boolean, token?: string) =>
      fetch(`${origin}/__editor/hmr`, {
        method: "POST",
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
        body: JSON.stringify({ hmr })
      });
    await expect(post(true)).resolves.toHaveProperty("status", 401);
    const same = await post(true, boot.token);
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ hmr: true, owner: "bin" });
    const refused = await post(false, boot.token);
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({ hmr: true, owner: "bin" });
    expect(app.pages.hotReload()).toEqual({ hmr: true, owner: "bin" });
  });

  it("P13: no log entry contains the token", () => {
    expect(JSON.stringify(app.log.trace())).not.toContain(app.hub.token());
  });

  it("answers 503 on the page and hello after stop", async () => {
    await app.stop();
    await expect(fetch(`${origin}/__editor/`)).resolves.toHaveProperty("status", 503);
    await expect(fetch(`${origin}/__editor/hello`)).resolves.toHaveProperty("status", 503);
  });
});
