/* eslint-disable unicorn/no-null -- JSON-RPC answers a parse error with id null */
import { describe, expect, it } from "vitest";
import {
  errorFrame,
  frameText,
  notificationFrame,
  parseLine,
  readLines,
  resultFrame,
  rpcCode
} from "../../../mcp/rpc";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp rpc (M1): newline-delimited JSON-RPC 2.0 on stdio. Lines are
// classified into requests, notifications, responses and invalid lines; every
// frame is one JSON line.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An async iterable of chunks, as stdin delivers them.
 *
 * @param chunks - The chunks.
 * @yields {string | Uint8Array} Each chunk in order.
 */
async function* chunksOf(...chunks: (string | Uint8Array)[]): AsyncGenerator<string | Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

describe("parseLine", () => {
  it("reads a request with string or number ids and object params", () => {
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({
      kind: "request",
      request: { id: 1, method: "ping", params: undefined }
    });
    expect(parseLine('{"jsonrpc":"2.0","id":"a","method":"tools/list","params":{}}')).toEqual({
      kind: "request",
      request: { id: "a", method: "tools/list", params: {} }
    });
  });

  it("reads a message without an id as a notification", () => {
    expect(parseLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({
      kind: "notification",
      notification: { method: "notifications/initialized", params: undefined }
    });
  });

  it("reads a message without a method as a response (the bridge ignores them)", () => {
    expect(parseLine('{"jsonrpc":"2.0","id":4,"result":{}}')).toEqual({ kind: "response" });
  });

  it("answers -32700 for a line that is not JSON", () => {
    expect(parseLine("{nope")).toEqual({
      kind: "invalid",
      id: undefined,
      code: rpcCode.parseError,
      message: "parse error"
    });
  });

  it("answers -32600 for a batch, a non-object, a bad jsonrpc, method or id", () => {
    expect(parseLine("[1]")).toMatchObject({ code: rpcCode.invalidRequest });
    expect(parseLine("7")).toMatchObject({ code: rpcCode.invalidRequest });
    expect(parseLine('{"jsonrpc":"1.0","id":3,"method":"ping"}')).toMatchObject({
      id: 3,
      code: rpcCode.invalidRequest
    });
    expect(parseLine('{"jsonrpc":"2.0","id":3,"method":""}')).toMatchObject({
      code: rpcCode.invalidRequest
    });
    expect(parseLine('{"jsonrpc":"2.0","id":null,"method":"ping"}')).toMatchObject({
      id: undefined,
      code: rpcCode.invalidRequest
    });
  });

  it("answers -32602 for params that are not an object", () => {
    expect(parseLine('{"jsonrpc":"2.0","id":5,"method":"ping","params":[1]}')).toEqual({
      kind: "invalid",
      id: 5,
      code: rpcCode.invalidParams,
      message: "params must be an object"
    });
  });
});

describe("frames", () => {
  it("writes one JSON line per frame; an error without an id carries id null", () => {
    expect(frameText(resultFrame(1, {}))).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect(errorFrame(undefined, rpcCode.parseError, "parse error")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_700, message: "parse error" }
    });
    expect(notificationFrame("notifications/tools/list_changed")).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed"
    });
    expect(notificationFrame("notifications/progress", { progressToken: 1, progress: 2 })).toEqual({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 1, progress: 2 }
    });
  });
});

describe("readLines", () => {
  it("joins chunks, splits lines, drops CR and blank lines, keeps a last line without newline", async () => {
    const lines: string[] = [];
    const encoder = new TextEncoder();
    const bytes = encoder.encode('{"b":"é"}\r\n');
    await readLines(
      chunksOf('{"a"', ":1}\n\n", bytes.slice(0, 7), bytes.slice(7), "  \n", '{"c":3}'),
      line => lines.push(line)
    );
    expect(lines).toEqual(['{"a":1}', '{"b":"é"}', '{"c":3}']);
  });
});
