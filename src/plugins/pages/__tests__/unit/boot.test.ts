import { describe, expect, it } from "vitest";
import type { ToolsBoot } from "../../../registry/protocol";
import { buildBoot, escapeHtml, injectBoot, safeJson } from "../../boot";
import { bootJsonOf, createHarness, request, TEMPLATE, TOKEN } from "../helpers";

const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:4000/__editor/ws",
  token: TOKEN,
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/projects/merge-game",
  gameUrl: "/"
};

describe("safeJson", () => {
  it("escapes <, >, &, U+2028 and U+2029 so no value closes the script tag", () => {
    const text = safeJson({ a: "</script><!-- & \u2028\u2029" });
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text).toContain(String.raw`\u003c/script\u003e\u003c!-- \u0026 \u2028\u2029`);
  });

  it("round-trips through JSON.parse", () => {
    const value = { title: "</script><script>alert(1)</script>", n: 1, list: ["&amp;"] };
    expect(JSON.parse(safeJson(value))).toEqual(value);
  });
});

describe("escapeHtml", () => {
  it("escapes & < > \" and '", () => {
    expect(escapeHtml(`a & <b> "c" 'd'`)).toBe("a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("moku editor")).toBe("moku editor");
  });
});

describe("injectBoot", () => {
  it("places the boot tag right before </head> and replaces the title", () => {
    const html = injectBoot(TEMPLATE, BOOT, "my game");
    expect(html).toBe(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>my game</title>
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
  <script type="application/json" id="moku-editor-boot">${safeJson(BOOT)}</script></head>
  <body><div data-editor-root></div></body>
</html>
`);
    const page = html ?? "";
    expect(page).toContain("<title>my game</title>");
    expect(page).toContain(
      `<script type="application/json" id="moku-editor-boot">${safeJson(BOOT)}</script></head>`
    );
    expect(JSON.parse(bootJsonOf(page) ?? "")).toEqual(BOOT);
  });

  it("leaves the rest of the template byte-identical", () => {
    const page = injectBoot(TEMPLATE, BOOT, "moku editor") ?? "";
    const tag = `<script type="application/json" id="moku-editor-boot">${safeJson(BOOT)}</script>`;
    expect(page.replace(tag, "")).toBe(TEMPLATE);
  });

  it("handles </HEAD> and <TITLE> in upper case", () => {
    const page = injectBoot("<HTML><HEAD><TITLE>x</TITLE></HEAD><BODY></BODY></HTML>", BOOT, "t");
    expect(page).toBe(
      `<HTML><HEAD><TITLE>t</TITLE><script type="application/json" id="moku-editor-boot">${safeJson(BOOT)}</script></HEAD><BODY></BODY></HTML>`
    );
  });

  it("escapes the title and never interprets $ patterns", () => {
    const page = injectBoot(TEMPLATE, BOOT, "</title><script>$&$1</script>") ?? "";
    expect(page).toContain("<title>&lt;/title&gt;&lt;script&gt;$&amp;$1&lt;/script&gt;</title>");
  });

  it("keeps a template without a title and returns undefined without </head>", () => {
    expect(injectBoot("<head></head>", BOOT, "t")).toBe(
      `<head><script type="application/json" id="moku-editor-boot">${safeJson(BOOT)}</script></head>`
    );
    expect(injectBoot("<html><body></body></html>", BOOT, "t")).toBeUndefined();
  });

  it("P7: a hostile title and editorUrl leave exactly one script element", () => {
    const hostile = {
      ...BOOT,
      title: "</script><script>alert(1)</script>",
      editorUrl: "x://</script>{path}"
    };
    const page = injectBoot(TEMPLATE, hostile, hostile.title) ?? "";
    expect(page.match(/<script/gi)).toHaveLength(1);
    expect(JSON.parse(bootJsonOf(page) ?? "")).toEqual(hostile);
  });
});

describe("buildBoot", () => {
  it("returns exactly the eight ToolsBoot keys from hub, files and config", () => {
    const { deps } = createHarness("/pages", {
      title: "T",
      editorUrl: "cursor://file/{path}",
      gameUrl: "/game/"
    });
    const boot = buildBoot(request("/__editor/"), deps);
    expect(boot).toEqual({
      v: 1,
      ws: "ws://127.0.0.1:4000/__editor/ws",
      token: TOKEN,
      path: "/__editor",
      title: "T",
      editorUrl: "cursor://file/{path}",
      root: "/projects/merge-game",
      gameUrl: "/game/"
    });
    expect(Object.keys(boot).toSorted()).toEqual([
      "editorUrl",
      "gameUrl",
      "path",
      "root",
      "title",
      "token",
      "v",
      "ws"
    ]);
  });

  it("builds the ws URL from the request Host", () => {
    const { deps } = createHarness("/pages");
    const req = request("/__editor/", { headers: { host: "localhost:4000" } });
    expect(buildBoot(req, deps).ws).toBe("ws://localhost:4000/__editor/ws");
  });

  it("falls back to the URL host when the request has no Host header", () => {
    const { deps } = createHarness("/pages");
    expect(buildBoot(new Request("http://localhost:4000/__editor/"), deps).ws).toBe(
      "ws://localhost:4000/__editor/ws"
    );
  });

  it("throws when the hub has no token", () => {
    const { deps, hub } = createHarness("/pages");
    hub.started = false;
    expect(() => buildBoot(request("/__editor/"), deps)).toThrow(/\[moku-editor\]/);
  });
});
