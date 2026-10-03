/* eslint-disable sonarjs/no-clear-text-protocols -- the hub serves plain http on 127.0.0.1 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServerCore, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import { notification, request, toWireValue } from "../../../registry/protocol";
import { hubPlugin } from "../..";
import type { HubSocketData } from "../../types";
import type { Client } from "./clients";
import {
  AGENT_MANIFEST,
  connectAgent,
  connectClient,
  isResponseTo,
  rawStatus,
  shutdown,
  upgradeStatus
} from "./clients";

// ─────────────────────────────────────────────────────────────────────────────
// The hub security table (04-hub.md, H1–H17 and H25–H39) over real HTTP and
// real websockets. P is the server port; unless a row says otherwise the
// request uses Host 127.0.0.1:P, Origin http://127.0.0.1:P, the right token
// and kind=tools.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createServerCore(serverCoreConfig, { plugins: [filesPlugin, hubPlugin] });

/** One running editor server. */
type Running = {
  readonly app: ReturnType<typeof framework.createApp>;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly token: string;
};

let base: string;
const servers: Running[] = [];
const clients: Client[] = [];

/**
 * Creates, starts and serves an editor app; registers a same-origin test route first.
 *
 * @param allow - Extra allowed origins.
 * @returns The running app.
 */
async function serveEditor(allow: readonly string[] = []): Promise<Running> {
  const app = framework.createApp({
    pluginConfigs: { files: { root: base }, hub: { allow } }
  });
  app.hub.addRoutes({
    "/__editor/hello": (req, server) =>
      app.hub.guard(req, server, "same-origin") ?? Response.json({ ok: true })
  });
  await app.start();
  const server = Bun.serve(app.hub.serve({ port: 0 }));
  const running: Running = { app, server, port: server.port ?? 0, token: app.hub.token() };
  servers.push(running);
  return running;
}

/**
 * Remembers a client for cleanup.
 *
 * @param client - The client.
 * @returns The same client.
 */
function keep<T extends Client>(client: T): T {
  clients.push(client);
  return client;
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "moku-hub-sec-"));
  await mkdir(join(base, "src"), { recursive: true });
  await writeFile(join(base, "src/a.ts"), "export const a = 1;\n");
});

afterEach(async () => {
  const open = clients.splice(0);
  for (const client of open) client.close();
  for (const running of servers.splice(0)) {
    const { app, server } = running;
    await shutdown(open, () => app.stop(), server);
  }
  await rm(base, { recursive: true, force: true });
});

describe("upgrade refusals over HTTP (H1–H17)", () => {
  it("H1–H3: no token, wrong token of the same length, of another length → 401", async () => {
    const { port, token } = await serveEditor();
    const sameLength = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(await upgradeStatus(port, {})).toBe(401);
    expect(await upgradeStatus(port, { token: sameLength })).toBe(401);
    expect(await upgradeStatus(port, { token: "short" })).toBe(401);
    expect(await upgradeStatus(port, { token })).toBe(101);
  });

  it("H4–H8: evil, missing, null, other-port and https origins → 403", async () => {
    const { port, token } = await serveEditor();

    expect(await upgradeStatus(port, { token, origin: "http://evil.com" })).toBe(403);
    expect(await upgradeStatus(port, { token, origin: undefined })).toBe(403);
    expect(await upgradeStatus(port, { token, origin: "null" })).toBe(403);
    expect(await upgradeStatus(port, { token, origin: `http://127.0.0.1:${port + 1}` })).toBe(403);
    expect(await upgradeStatus(port, { token, origin: `https://127.0.0.1:${port}` })).toBe(403);
  });

  it("H9: localhost origin and host → 101", async () => {
    const { port, token } = await serveEditor();

    expect(
      await upgradeStatus(port, {
        token,
        origin: `http://localhost:${port}`,
        host: `localhost:${port}`
      })
    ).toBe(101);
  });

  it("H10: an origin listed in config.allow → 101", async () => {
    const { port, token } = await serveEditor(["http://192.168.1.4:3000"]);

    expect(await upgradeStatus(port, { token, origin: "http://192.168.1.4:3000" })).toBe(101);
  });

  it("H11, H12: DNS rebinding and an evil origin on the right host → 403", async () => {
    const { port, token } = await serveEditor();

    expect(
      await upgradeStatus(port, {
        token,
        host: `evil.com:${port}`,
        origin: `http://evil.com:${port}`
      })
    ).toBe(403);
    expect(await upgradeStatus(port, { token, origin: `http://evil.com:${port}` })).toBe(403);
  });

  it("H13: no Host header (raw socket) is refused", async () => {
    const { port, token } = await serveEditor();
    const upgrade = [
      `GET /__editor/ws?token=${token}&kind=tools HTTP/1.0`,
      `Origin: http://127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n");

    expect(await rawStatus(port, upgrade)).toBe(403);
    expect(await rawStatus(port, upgrade.replace("HTTP/1.0", "HTTP/1.1"))).not.toBe(101);
  });

  it("H14: lookalike hosts → 403; LOCALHOST → 101", async () => {
    const { port, token } = await serveEditor();

    expect(await upgradeStatus(port, { token, host: `127.0.0.1.evil.com:${port}` })).toBe(403);
    expect(await upgradeStatus(port, { token, host: `localhost.evil.com:${port}` })).toBe(403);
    expect(await upgradeStatus(port, { token, host: `LOCALHOST:${port}` })).toBe(101);
  });

  it("H15: missing or unknown kind → 400", async () => {
    const { port, token } = await serveEditor();

    expect(await upgradeStatus(port, { token, kind: undefined })).toBe(400);
    expect(await upgradeStatus(port, { token, kind: "admin" })).toBe(400);
  });

  it("H16: a GET without Upgrade → 426", async () => {
    const { port, token } = await serveEditor();

    expect(await upgradeStatus(port, { token, upgrade: undefined })).toBe(426);
  });

  it("H17: before start and after stop → 503", async () => {
    const app = framework.createApp({
      pluginConfigs: { files: { root: base } }
    });
    const early = Bun.serve<HubSocketData>({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => app.hub.fetch(req, server) ?? new Response("upgraded"),
      websocket: app.hub.websocket
    });
    try {
      expect(await upgradeStatus(early.port ?? 0, { token: "x".repeat(43) })).toBe(503);
    } finally {
      await Promise.race([early.stop(true), Bun.sleep(300)]);
    }

    const { app: started, port, token } = await serveEditor();
    await started.stop();
    expect(await upgradeStatus(port, { token })).toBe(503);
  });

  it("H18: no log entry carries the token or a URL with token=", async () => {
    const { app, port, token } = await serveEditor();
    await upgradeStatus(port, {});
    await upgradeStatus(port, { token: "short" });
    await upgradeStatus(port, { token, origin: "http://evil.com" });
    await upgradeStatus(port, { token, kind: "admin" });
    await upgradeStatus(port, { token, upgrade: undefined });
    keep(await connectClient(port, { token, kind: "tools" }));

    const logged = JSON.stringify(app.log.trace());
    expect(logged).toContain("hub:refused");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("token=");
  });
});

describe("tokens per start (H25)", () => {
  it("gives every app its own token; one app's token is refused by the other", async () => {
    const first = await serveEditor();
    const second = await serveEditor();

    expect(first.token).not.toBe(second.token);
    expect(await upgradeStatus(second.port, { token: first.token })).toBe(401);
    expect(await upgradeStatus(second.port, { token: second.token })).toBe(101);
  });
});

describe("agent rules (H26–H30)", () => {
  it("H26: an agent files request → -32007 unauthorized, nothing written", async () => {
    const { port, token } = await serveEditor();
    const { agent } = await connectAgent(port, token);
    keep(agent);

    agent.send(request(1, "files", "write", { path: "src/pwned.ts", text: "x" }));

    expect(await agent.next(isResponseTo(1))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32_007,
        message: "[moku-editor] agents cannot send requests",
        data: { reason: "unauthorized", retryable: false }
      }
    });
    await expect(stat(join(base, "src/pwned.ts"))).rejects.toThrow();
  });

  it("H27: an agent game run request → -32007", async () => {
    const { port, token } = await serveEditor();
    const { agent } = await connectAgent(port, token);
    keep(agent);

    agent.send(request(2, "game", "run", { id: "game.step", input: { frames: 1 } }));

    expect(await agent.next(isResponseTo(2))).toMatchObject({ error: { code: -32_007 } });
  });

  it("H28: an agent whose first message is a heartbeat is closed 1008", async () => {
    const { port, token } = await serveEditor();
    const agent = keep(await connectClient(port, { token, kind: "agent" }));

    agent.send(notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));

    expect(await agent.closed).toEqual({ code: 1008, reason: "hello first" });
  });

  it("H29: a second hello closes 1008", async () => {
    const { port, token } = await serveEditor();
    const { agent } = await connectAgent(port, token);
    keep(agent);

    agent.send(
      notification("game", "hello", { manifest: toWireValue({ ...AGENT_MANIFEST, sources: [] }) })
    );

    expect(await agent.closed).toEqual({ code: 1008, reason: "hello twice" });
  });

  it("H30: a manifest without sources, with a 129-char id or effect sudo closes 1008", async () => {
    const { port, token } = await serveEditor();
    const noSources = Object.fromEntries(
      Object.entries(AGENT_MANIFEST).filter(([key]) => key !== "sources")
    );
    const bad = [
      noSources,
      {
        ...AGENT_MANIFEST,
        sources: [{ id: "a".repeat(129), title: "t", input: {}, changes: "frame" }]
      },
      { ...AGENT_MANIFEST, commands: [{ id: "c", title: "c", input: {}, effect: "sudo" }] }
    ];
    for (const manifest of bad) {
      const agent = keep(await connectClient(port, { token, kind: "agent" }));
      agent.send(notification("game", "hello", { manifest: toWireValue(manifest) }));
      expect(await agent.closed).toEqual({ code: 1008, reason: "bad manifest" });
    }
  });
});

describe("tools rules (H31–H36)", () => {
  it("H31, H32: unknown ids and bad input are refused before the agent", async () => {
    const { port, token } = await serveEditor();
    const { agent } = await connectAgent(port, token);
    keep(agent);
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    page.send(request(1, "game", "read", { id: "game.secrets" }));
    page.send(request(2, "game", "run", { id: "game.step", input: { frames: 1, god: true } }));
    page.send(request(3, "game", "run", { id: "game.step", input: { frames: "1" } }));

    expect(await page.next(isResponseTo(1))).toMatchObject({
      error: { code: -32_601, data: { reason: "unknown_id", id: "game.secrets" } }
    });
    expect(await page.next(isResponseTo(2))).toMatchObject({
      error: { code: -32_602, data: { field: "god" } }
    });
    expect(await page.next(isResponseTo(3))).toMatchObject({
      error: { code: -32_602, data: { field: "frames" } }
    });
    expect(agent.messages.filter(message => "id" in message)).toEqual([]);
  });

  it("H33: files write ../x.ts and readBinary of a .ts file → -32004", async () => {
    const { port, token } = await serveEditor();
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    page.send(request(1, "files", "write", { path: "../x.ts", text: "x" }));
    page.send(request(2, "files", "readBinary", { path: "src/a.ts" }));

    expect(await page.next(isResponseTo(1))).toMatchObject({
      error: { code: -32_004, data: { reason: "forbidden_path" } }
    });
    expect(await page.next(isResponseTo(2))).toMatchObject({ error: { code: -32_004 } });
  });

  it("H34: a binary frame closes 1003", async () => {
    const { port, token } = await serveEditor();
    const page = keep(await connectClient(port, { token, kind: "tools" }));
    const agent = keep(await connectClient(port, { token, kind: "agent" }));

    page.send(new Uint8Array([1, 2, 3]));
    agent.send(new Uint8Array([4]));

    const [pageClosed, agentClosed] = await Promise.all([page.closed, agent.closed]);
    expect(pageClosed.code).toBe(1003);
    expect(agentClosed.code).toBe(1003);
  });

  it("H35: ten undecodable frames close 1008", async () => {
    const { port, token } = await serveEditor();
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    for (let index = 0; index < 10; index += 1) page.send("{not json");

    expect(await page.closed).toEqual({ code: 1008, reason: "too many invalid messages" });
  });

  it("H36: the 257th concurrent pending call → -32600", async () => {
    const { port, token } = await serveEditor();
    const { agent } = await connectAgent(port, token);
    keep(agent);
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    for (let id = 1; id <= 257; id += 1)
      page.send(request(id, "game", "read", { id: "game.position" }));

    expect(await page.next(isResponseTo(257))).toMatchObject({
      error: { code: -32_600, message: "[moku-editor] too many pending calls" }
    });
  });
});

describe("guard and frames (H37–H39)", () => {
  it("H37: same-origin guard refuses Sec-Fetch-Site cross-site", async () => {
    const { port } = await serveEditor();
    const url = `http://127.0.0.1:${port}/__editor/hello`;

    const crossSite = await fetch(url, { headers: { "sec-fetch-site": "cross-site" } });
    const sameOrigin = await fetch(url, { headers: { "sec-fetch-site": "same-origin" } });
    expect(crossSite.status).toBe(403);
    expect(sameOrigin.status).toBe(200);
  });

  it("H38: a frame over 32 MiB closes the connection", async () => {
    const { port, token } = await serveEditor();
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    page.send("x".repeat(32 * 1024 * 1024 + 1));

    // Bun closes an oversized frame with 1009 server-side; its client reports 1006.
    const { code } = await page.closed;
    expect([1006, 1009]).toContain(code);
  });

  it("H39: a hub-side files error carries a message only, no stack", async () => {
    const { port, token } = await serveEditor();
    const page = keep(await connectClient(port, { token, kind: "tools" }));

    page.send(request(1, "files", "read", { path: "src/missing.ts" }));

    const response = await page.next(isResponseTo(1));
    expect(response).toMatchObject({
      error: { message: expect.stringMatching(/^\[moku-editor] /) }
    });
    expect(JSON.stringify(response)).not.toContain("stack");
  });
});
