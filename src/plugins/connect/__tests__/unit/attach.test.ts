/* eslint-disable unicorn/no-null -- null is "no session" on an attach record */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachCdp, detachCdp, fetchJson } from "../../cdp/attach";
import { openCdpSocket } from "../../cdp/client";
import { createAttachRecord } from "../../state";
import { a26, createCtx, fakeRunner, ok, PAGE, SERIAL } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C5: CDP attach over adb forward to a fake CDP server (Bun.serve with
// /json/list and a WebSocket), the adb runner a fake that prints its port.
// Bug: a forward left open after the panel closed, a socket to the wrong page,
// or a DevTools socket Chrome refuses for its Origin.
// ─────────────────────────────────────────────────────────────────────────────

/** What the fake CDP server saw. */
type Seen = { paths: string[]; origins: (string | null)[]; closes: number };

/** A running fake CDP server. */
type CdpServer = { readonly port: number; readonly seen: Seen; stop(): Promise<void> };

let server: CdpServer | undefined;

/**
 * Starts a fake CDP server whose /json/list answers the given targets.
 *
 * @param targets - Builds the target list from the server's port.
 * @returns The server.
 */
function startServer(targets: (port: number) => unknown[]): CdpServer {
  const seen: Seen = { paths: [], origins: [], closes: 0 };
  const bun = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/json/list") return Response.json(targets(srv.port ?? 0));
      seen.paths.push(url.pathname);
      seen.origins.push(req.headers.get("origin"));
      return srv.upgrade(req, { data: undefined })
        ? undefined
        : new Response("no", { status: 400 });
    },
    websocket: {
      message(ws, text) {
        const { id } = JSON.parse(String(text)) as { id: number };
        ws.send(JSON.stringify({ id, result: { usedSize: 1_048_576, totalSize: 2_097_152 } }));
      },
      close() {
        seen.closes += 1;
      }
    }
  });
  const port = bun.port ?? 0;
  server = { port, seen, stop: () => bun.stop(true) };
  return server;
}

/**
 * A target of /json/list.
 *
 * @param port - The server's port.
 * @param id - The target id.
 * @param url - The page URL.
 * @param type - The target type.
 * @returns The target.
 */
function target(port: number, id: number, url: string, type = "page") {
  return {
    id: String(id),
    type,
    url,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`
  };
}

/**
 * A ctx whose adb forward prints the fake server's port, with the runtime fetch and socket.
 *
 * @param port - The fake server's port.
 * @returns The ctx.
 */
function ctxFor(port: number) {
  const run = fakeRunner(args =>
    args[2] === "forward" && args[3] !== "--remove" ? ok(`${port}\n`) : a26(args)
  );
  const ctx = createCtx({ run });
  ctx.state.deps = { run, fetchJson, openSocket: openCdpSocket };
  return ctx;
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("attachCdp", () => {
  it("connects to the page target whose URL is the session page without the hash, with no Origin", async () => {
    const { port, seen } = startServer(at => [
      target(at, 3, PAGE, "service_worker"),
      target(at, 5, "http://tauri.localhost/other"),
      target(at, 7, `${PAGE}#/menu`)
    ]);
    const ctx = ctxFor(port);
    const attach = createAttachRecord("d-7f3a", SERIAL, `${PAGE}#/play`);

    const socket = await attachCdp(ctx, attach, ["webview_devtools_remote_23811"]);

    expect(socket).toBe("webview_devtools_remote_23811");
    expect(seen.paths).toEqual(["/devtools/page/7"]);
    expect(seen.origins).toEqual([null]);
    expect(ctx.state.forwards).toEqual(new Map([[port, SERIAL]]));
    await expect(attach.cdp?.client.send("Runtime.getHeapUsage")).resolves.toEqual({
      usedSize: 1_048_576,
      totalSize: 2_097_152
    });
    await detachCdp(ctx, attach);
  });

  it("is no-devtools-socket without a socket, and asks adb for no forward", async () => {
    const ctx = ctxFor(1);
    const attach = createAttachRecord("d-7f3a", SERIAL, PAGE);
    await expect(attachCdp(ctx, attach, [])).resolves.toBeUndefined();
    expect(attach.heap.off).toBe("no-devtools-socket");
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it("is no-target when no page matches, and removes the forward it made", async () => {
    const { port } = startServer(at => [target(at, 5, "http://tauri.localhost/other")]);
    const ctx = ctxFor(port);
    const attach = createAttachRecord("d-7f3a", SERIAL, PAGE);

    await expect(
      attachCdp(ctx, attach, ["webview_devtools_remote_23811"])
    ).resolves.toBeUndefined();

    expect(attach.heap.off).toBe("no-target");
    expect(ctx.run.calls().at(-1)).toEqual(["-s", SERIAL, "forward", "--remove", `tcp:${port}`]);
    expect(ctx.state.forwards.size).toBe(0);
  });

  it("detach closes the socket and removes the recorded forward", async () => {
    const { port, seen } = startServer(at => [target(at, 7, PAGE)]);
    const ctx = ctxFor(port);
    const attach = createAttachRecord("d-7f3a", SERIAL, PAGE);
    await attachCdp(ctx, attach, ["webview_devtools_remote_23811"]);

    await detachCdp(ctx, attach);

    expect(attach.cdp).toBeUndefined();
    expect(ctx.run.calls().at(-1)).toEqual(["-s", SERIAL, "forward", "--remove", `tcp:${port}`]);
    expect(ctx.state.forwards.size).toBe(0);
    await vi.waitFor(() => expect(seen.closes).toBe(1));
  });

  it("closes at once when the lease ended before /json/list answered", async () => {
    // Bug: a forward left open after the panel closed.
    const { port, seen } = startServer(at => [target(at, 7, PAGE)]);
    const ctx = ctxFor(port);
    const attach = createAttachRecord("d-7f3a", SERIAL, PAGE);
    ctx.state.deps = {
      ...ctx.state.deps,
      fetchJson: async (url, timeoutMs) => {
        attach.ended = true;
        return fetchJson(url, timeoutMs);
      }
    };

    await expect(
      attachCdp(ctx, attach, ["webview_devtools_remote_23811"])
    ).resolves.toBeUndefined();

    expect(attach.cdp).toBeUndefined();
    expect(seen.paths).toEqual([]);
    expect(ctx.run.calls().at(-1)).toEqual(["-s", SERIAL, "forward", "--remove", `tcp:${port}`]);
    expect(ctx.state.forwards.size).toBe(0);
  });

  it("never dials a debugger URL off this computer's forward", async () => {
    const { port, seen } = startServer(() => [
      { type: "page", url: PAGE, webSocketDebuggerUrl: "ws://192.0.2.7:9222/devtools/page/7" }
    ]);
    const ctx = ctxFor(port);
    const attach = createAttachRecord("d-7f3a", SERIAL, PAGE);
    await expect(
      attachCdp(ctx, attach, ["webview_devtools_remote_23811"])
    ).resolves.toBeUndefined();
    expect(attach.heap.off).toBe("no-target");
    expect(seen.paths).toEqual([]);
  });
});
