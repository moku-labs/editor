// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoot, refreshBoot } from "../../boot/read";
import { BOOT, installBoot } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The boot tag and the hello refresh
// ─────────────────────────────────────────────────────────────────────────────

const SELECTOR = "#moku-editor-boot";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("readBoot", () => {
  it("parses a valid ToolsBoot tag", () => {
    installBoot();
    expect(readBoot(SELECTOR, document)).toEqual(BOOT);
  });

  it("is undefined without a tag or a document", () => {
    expect(readBoot(SELECTOR, document)).toBeUndefined();
    expect(readBoot(SELECTOR, undefined)).toBeUndefined();
  });

  it("is undefined for invalid JSON, v 2, a missing token or a missing gameUrl", () => {
    installBoot("{not json");
    expect(readBoot(SELECTOR, document)).toBeUndefined();

    installBoot(JSON.stringify({ ...BOOT, v: 2 }));
    expect(readBoot(SELECTOR, document)).toBeUndefined();

    installBoot(JSON.stringify({ ...BOOT, token: undefined }));
    expect(readBoot(SELECTOR, document)).toBeUndefined();

    installBoot(JSON.stringify({ ...BOOT, gameUrl: undefined }));
    expect(readBoot(SELECTOR, document)).toBeUndefined();
  });

  it("is undefined for an empty tag or an invalid selector", () => {
    installBoot("");
    expect(readBoot(SELECTOR, document)).toBeUndefined();
    expect(readBoot("##", document)).toBeUndefined();
  });
});

describe("refreshBoot", () => {
  it("fetches {path}/hello on the page origin and merges ws and token", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return Response.json({ ws: "ws://127.0.0.1:3000/__editor/ws", token: "fresh" });
    });

    const fresh = await refreshBoot(BOOT);

    expect(fresh).toEqual({ ...BOOT, token: "fresh" });
    expect(urls).toHaveLength(1);
    const url = urls[0] ?? "";
    expect(new URL(url).pathname).toBe("/__editor/hello");
    expect(new URL(url).origin).toBe(location.origin);
  });

  it("resolves a relative ws against the page", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ws: "/__editor/ws", token: "t2" }));
    const fresh = await refreshBoot(BOOT);
    expect(fresh?.ws).toBe(new URL("/__editor/ws", location.href).href);
  });

  it("is undefined when fetch fails, answers an error or a bad body", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    expect(await refreshBoot(BOOT)).toBeUndefined();

    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    expect(await refreshBoot(BOOT)).toBeUndefined();

    vi.stubGlobal("fetch", async () => Response.json({ ws: 1 }));
    expect(await refreshBoot(BOOT)).toBeUndefined();

    vi.stubGlobal("fetch", async () => new Response("{nope"));
    expect(await refreshBoot(BOOT)).toBeUndefined();
  });
});
