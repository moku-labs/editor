import { describe, expect, it } from "vitest";
import { parseBinArgs } from "../../args";

describe("parseBinArgs", () => {
  it("parses one HTML file with the defaults", () => {
    expect(parseBinArgs(["web/index.html"])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 3000,
      root: ".",
      hmr: true
    });
  });

  it("reads --port and --root, short flags too", () => {
    expect(parseBinArgs(["web/index.html", "--port", "0", "--root", ".."])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 0,
      root: "..",
      hmr: true
    });
    expect(parseBinArgs(["-p", "65535", "-r", "game", "INDEX.HTML"])).toEqual({
      kind: "run",
      html: "INDEX.HTML",
      port: 65_535,
      root: "game",
      hmr: true
    });
  });

  it("turns hot reload off with --no-hmr, anywhere in argv", () => {
    expect(parseBinArgs(["web/index.html", "--no-hmr"])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 3000,
      root: ".",
      hmr: false
    });
    const first = parseBinArgs(["--no-hmr", "-p", "0", "web/index.html"]);
    expect(first.kind === "run" && first.hmr).toBe(false);
  });

  it("refuses a value on --no-hmr and an unknown --hmr", () => {
    expect(parseBinArgs(["a.html", "--no-hmr=1"]).kind).toBe("error");
    expect(parseBinArgs(["a.html", "--hmr"]).kind).toBe("error");
  });

  it("returns help for --help or -h anywhere", () => {
    expect(parseBinArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseBinArgs(["web/index.html", "-h"])).toEqual({ kind: "help" });
    expect(parseBinArgs(["--bogus", "--help"])).toEqual({ kind: "help" });
  });

  it.each([[[]], [["a.html", "b.html"]]])("refuses %j: expected one game HTML file", argv => {
    const result = parseBinArgs(argv);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain("expected one game HTML file");
  });

  it("refuses a positional that is not an .html file", () => {
    expect(parseBinArgs(["web/index.ts"]).kind).toBe("error");
  });

  it.each(["abc", "70000", "3.5", "-1", "", "1e3", " 80"])("refuses --port=%s", port => {
    const result = parseBinArgs(["a.html", `--port=${port}`]);
    expect(result.kind === "error" && result.message).toContain(
      "--port must be an integer 0-65535"
    );
  });

  it("refuses --port -1 (an ambiguous value)", () => {
    expect(parseBinArgs(["a.html", "--port", "-1"]).kind).toBe("error");
  });

  it("refuses an empty --root", () => {
    const result = parseBinArgs(["a.html", "--root", ""]);
    expect(result.kind === "error" && result.message).toContain("--root");
  });

  it("P14: refuses unknown flags such as --host (the host is always 127.0.0.1)", () => {
    const result = parseBinArgs(["x.html", "--host", "0.0.0.0"]);
    expect(result.kind).toBe("error");
  });

  it("starts every error message with [moku-editor]", () => {
    for (const argv of [
      [],
      ["a.ts"],
      ["a.html", "--port=x"],
      ["a.html", "--root="],
      ["a.html", "--host=x"]
    ]) {
      const result = parseBinArgs(argv);
      expect(result.kind === "error" && result.message.startsWith("[moku-editor] ")).toBe(true);
    }
  });
});

describe("parseBinArgs mcp (M2, M3)", () => {
  it("parses `mcp` alone: no html, no port, root . and hot reload on", () => {
    expect(parseBinArgs(["mcp"])).toEqual({ kind: "mcp", root: ".", hmr: true });
  });

  it("parses `mcp` with the game arguments that feed the launcher", () => {
    expect(
      parseBinArgs(["mcp", "web/index.html", "--port", "3001", "--root", "game", "--no-hmr"])
    ).toEqual({ kind: "mcp", html: "web/index.html", port: 3001, root: "game", hmr: false });
    expect(parseBinArgs(["-p", "0", "mcp", "a.html"])).toEqual({
      kind: "mcp",
      html: "a.html",
      port: 0,
      root: ".",
      hmr: true
    });
  });

  it("leaves port out when --port is not given (discovery decides)", () => {
    const result = parseBinArgs(["mcp", "web/index.html"]);
    expect(result.kind === "mcp" && "port" in result).toBe(false);
  });

  it.each([
    [["mcp", "a.html", "b.html"], "expected at most one game HTML file"],
    [["mcp", "index.ts"], "ending in .html"],
    [["mcp", "--port", "x"], "--port must be an integer 0-65535"],
    [["mcp", "--root", ""], "--root must not be empty"],
    [["mcp", "--host", "0.0.0.0"], "[moku-editor] "]
  ])("refuses %j", (argv, message) => {
    const result = parseBinArgs(argv);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain(message);
    expect(result.kind === "error" && result.message.startsWith("[moku-editor] ")).toBe(true);
  });

  it("returns help for `mcp --help`", () => {
    expect(parseBinArgs(["mcp", "--help"])).toEqual({ kind: "help" });
  });
});

describe("parseBinArgs mcp-config (M8)", () => {
  it("parses `mcp-config` alone and with html and port", () => {
    expect(parseBinArgs(["mcp-config"])).toEqual({ kind: "mcp-config" });
    expect(parseBinArgs(["mcp-config", "web/index.html", "-p", "3000"])).toEqual({
      kind: "mcp-config",
      html: "web/index.html",
      port: 3000
    });
  });

  it.each([
    [["mcp-config", "a.html", "b.html"], "expected at most one game HTML file"],
    [["mcp-config", "a.txt"], "ending in .html"],
    [["mcp-config", "--port", "99999"], "--port must be an integer 0-65535"],
    [["mcp-config", "--root", "game"], "mcp-config takes only <game-html> and --port"],
    [["mcp-config", "--no-hmr"], "mcp-config takes only <game-html> and --port"]
  ])("refuses %j", (argv, message) => {
    const result = parseBinArgs(argv);
    expect(result.kind === "error" && result.message).toContain(message);
  });

  it("treats a subcommand only in first position: `a.html mcp` is two positionals", () => {
    const result = parseBinArgs(["a.html", "mcp"]);
    expect(result.kind === "error" && result.message).toContain("expected one game HTML file");
  });
});
