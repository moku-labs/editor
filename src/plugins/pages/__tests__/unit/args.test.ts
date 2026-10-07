import { describe, expect, it } from "vitest";
import { parseBinArgs } from "../../args";

describe("parseBinArgs", () => {
  it("parses one HTML file with the defaults", () => {
    expect(parseBinArgs(["web/index.html"])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 3000,
      root: ".",
      hmr: true,
      preload: [],
      servePlugins: []
    });
  });

  it("reads --port and --root, short flags too", () => {
    expect(parseBinArgs(["web/index.html", "--port", "0", "--root", ".."])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 0,
      root: "..",
      hmr: true,
      preload: [],
      servePlugins: []
    });
    expect(parseBinArgs(["-p", "65535", "-r", "game", "INDEX.HTML"])).toEqual({
      kind: "run",
      html: "INDEX.HTML",
      port: 65_535,
      root: "game",
      hmr: true,
      preload: [],
      servePlugins: []
    });
  });

  it("turns hot reload off with --no-hmr, anywhere in argv", () => {
    expect(parseBinArgs(["web/index.html", "--no-hmr"])).toEqual({
      kind: "run",
      html: "web/index.html",
      port: 3000,
      root: ".",
      hmr: false,
      preload: [],
      servePlugins: []
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

  it("refuses two positionals: expected at most one game HTML file", () => {
    const result = parseBinArgs(["a.html", "b.html"]);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain(
      "expected at most one game HTML file"
    );
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
      ["a.html", "b.html"],
      ["a.ts"],
      ["a.html", "--port=x"],
      ["a.html", "--root="],
      ["a.html", "--host=x"],
      ["a.html", "--preload", "p.ts"],
      ["mcp", "--serve-plugin", "p.ts"],
      ["e2e", "-g", "x"]
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
    expect(result.kind === "error" && result.message).toContain(
      "expected at most one game HTML file"
    );
  });
});

describe("parseBinArgs engine page (B5)", () => {
  it("parses no positional as the engine page: no html key, the defaults and two empty lists", () => {
    const result = parseBinArgs([]);
    expect(result).toEqual({
      kind: "run",
      port: 3000,
      root: ".",
      hmr: true,
      preload: [],
      servePlugins: []
    });
    expect("html" in result).toBe(false);
  });

  it("reads --root, --port and --no-hmr without an html file", () => {
    expect(parseBinArgs(["--root", "games/timber", "-p", "0", "--no-hmr"])).toEqual({
      kind: "run",
      port: 0,
      root: "games/timber",
      hmr: false,
      preload: [],
      servePlugins: []
    });
  });

  it("collects every --preload and --serve-plugin in order, paths as given", () => {
    const result = parseBinArgs([
      "--preload",
      "a.ts",
      "--serve-plugin",
      "../engine/scripts/tree/bundle.ts",
      "--preload",
      "b.ts"
    ]);
    expect(result.kind === "run" && result.preload).toEqual(["a.ts", "b.ts"]);
    expect(result.kind === "run" && result.servePlugins).toEqual([
      "../engine/scripts/tree/bundle.ts"
    ]);
    expect(parseBinArgs(["--serve-plugin", "p.ts"])).toMatchObject({ servePlugins: ["p.ts"] });
  });

  it.each([
    [["web/index.html", "--preload", "a.ts"]],
    [["--serve-plugin", "p.ts", "web/index.html"]]
  ])("refuses %j: the two flags need the engine page", argv => {
    const result = parseBinArgs(argv);
    expect(result).toEqual({
      kind: "error",
      message: "[moku-editor] --preload and --serve-plugin need the engine page: drop the html file"
    });
  });

  it("refuses --preload without its value", () => {
    expect(parseBinArgs(["--preload"]).kind).toBe("error");
  });

  it.each([
    [["mcp", "--preload", "a.ts"]],
    [["mcp", "web/index.html", "--serve-plugin", "p.ts"]],
    [["mcp-config", "--preload", "a.ts"]],
    [["mcp-config", "--serve-plugin", "p.ts"]]
  ])("refuses %j: the two flags belong to the serving bin", argv => {
    expect(parseBinArgs(argv)).toEqual({
      kind: "error",
      message: "[moku-editor] --preload and --serve-plugin belong to the serving bin"
    });
  });
});

describe("parseBinArgs e2e (D-52)", () => {
  /** The error of an e2e without its Playwright config. */
  const NO_CONFIG = {
    kind: "error",
    message: "[moku-editor] e2e needs the Playwright config: -c <file>"
  };

  it("takes the config of -c and leaves nothing else", () => {
    expect(parseBinArgs(["e2e", "-c", "a.ts"])).toEqual({ kind: "e2e", config: "a.ts", rest: [] });
  });

  it("takes --config=<path> and hands the other words to Playwright in order", () => {
    expect(parseBinArgs(["e2e", "--config=a.ts", "-g", "pick", "--headed"])).toEqual({
      kind: "e2e",
      config: "a.ts",
      rest: ["-g", "pick", "--headed"]
    });
  });

  it("takes --config <path> anywhere, and only the first one", () => {
    expect(parseBinArgs(["e2e", "-g", "pick", "--config", "a.ts", "-c", "b.ts"])).toEqual({
      kind: "e2e",
      config: "a.ts",
      rest: ["-g", "pick", "-c", "b.ts"]
    });
  });

  it("passes --help to Playwright: the e2e words are not the bin's flags", () => {
    expect(parseBinArgs(["e2e", "--help", "-c", "a.ts"])).toEqual({
      kind: "e2e",
      config: "a.ts",
      rest: ["--help"]
    });
  });

  it.each([
    [["e2e"]],
    [["e2e", "-g", "x"]],
    [["e2e", "-c"]],
    [["e2e", "--config="]]
  ])("refuses %j: the Playwright config is required", argv => {
    expect(parseBinArgs(argv)).toEqual(NO_CONFIG);
  });

  it("treats e2e only in first position", () => {
    expect(parseBinArgs(["a.html", "e2e"]).kind).toBe("error");
  });
});
