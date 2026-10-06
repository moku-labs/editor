import { describe, expect, it } from "vitest";
import { forbidden, invalid } from "../../../files/errors";
import { request, wireError } from "../../../registry/protocol";
import { dispatchFiles } from "../../routing/files";
import { createHarness, errorOf, fakeFiles, resultOf } from "../helpers";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/**
 * A started hub with one tools socket.
 *
 * @returns The harness and the tools socket.
 */
function setup() {
  const harness = createHarness();
  const tools = harness.connect("tools");
  return { harness, tools, files: harness.ctx.files };
}

/**
 * Lets pending promises settle.
 */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("dispatchFiles", () => {
  it("calls list, read and write with the right args, results as Json", async () => {
    const files = fakeFiles();

    expect(await dispatchFiles(files, "list", { dir: "src" })).toEqual([
      { path: "src/a.ts", kind: "file", size: 3 }
    ]);
    expect(files.list).toHaveBeenCalledWith("src");

    expect(await dispatchFiles(files, "read", { path: "src/a.ts" })).toEqual({
      text: "abc",
      version: "v1"
    });
    expect(files.read).toHaveBeenCalledWith("src/a.ts");

    expect(
      await dispatchFiles(files, "write", { path: "src/a.ts", text: "x", version: "v1" })
    ).toEqual({ path: "src/a.ts", bytes: 1, version: "v2" });
    expect(files.write).toHaveBeenCalledWith("src/a.ts", "x", "v1");

    await dispatchFiles(files, "write", { path: "src/b.ts", text: "y" });
    expect(files.write).toHaveBeenLastCalledWith("src/b.ts", "y", undefined);
  });

  it("hands the writeBinary data URL to writeDataUrl with its path (R1)", async () => {
    const files = fakeFiles();

    const result = await dispatchFiles(files, "writeBinary", {
      path: ".moku/captures/a.png",
      data: PNG
    });

    expect(files.writeDataUrl).toHaveBeenCalledWith(".moku/captures/a.png", PNG);
    expect(files.writeBinary).not.toHaveBeenCalled();
    expect(result).toEqual({ path: ".moku/captures/a.png", bytes: 8, version: "v3" });
  });

  it("rethrows the writeDataUrl wire error of a mismatched mime unchanged", async () => {
    const files = fakeFiles();
    const error = invalid("data", "writeBinary: data type image/png does not match a.jpg");
    files.writeDataUrl.mockRejectedValueOnce(error);

    await expect(
      dispatchFiles(files, "writeBinary", { path: ".moku/captures/a.jpg", data: PNG })
    ).rejects.toBe(error);
  });

  it("answers readBinary with { dataUrl, version }", async () => {
    const files = fakeFiles();

    expect(await dispatchFiles(files, "readBinary", { path: ".moku/captures/a.png" })).toEqual({
      dataUrl: "data:image/png;base64,AA==",
      version: "v4"
    });
    expect(files.readBinary).toHaveBeenCalledWith(".moku/captures/a.png");
  });

  it("calls find with the key and answers the found list as Json", async () => {
    const files = fakeFiles();

    expect(await dispatchFiles(files, "find", { key: "node:board/merge" })).toEqual([
      {
        path: "nodes/merge.ts",
        binding: "merge",
        key: "node:board/merge",
        line: 17,
        range: [17, 1, 24, 3],
        hash: "h1"
      }
    ]);
    expect(files.find).toHaveBeenCalledWith("node:board/merge");
  });

  it("refuses find without a string key (-32602 on field key)", async () => {
    const files = fakeFiles();

    await expect(dispatchFiles(files, "find", {})).rejects.toMatchObject({
      code: -32_602,
      data: { field: "key" }
    });
    await expect(dispatchFiles(files, "find", { key: 7 })).rejects.toMatchObject({
      code: -32_602,
      data: { field: "key" }
    });
    expect(files.find).not.toHaveBeenCalled();
  });

  it("rethrows the find error of an index that is off unchanged", async () => {
    const files = fakeFiles();
    const error = wireError(-32_008, "project index off: disabled", {
      reason: "not_installed",
      retryable: false
    });
    files.find.mockRejectedValueOnce(error);

    await expect(dispatchFiles(files, "find", { key: "flow:main" })).rejects.toBe(error);
  });

  it("checks params with checkInput (-32602) and refuses unknown methods (-32601)", async () => {
    const files = fakeFiles();

    await expect(dispatchFiles(files, "read", { path: 1 })).rejects.toMatchObject({
      code: -32_602,
      data: { field: "path" }
    });
    await expect(dispatchFiles(files, "list", { dir: "a", extra: true })).rejects.toMatchObject({
      code: -32_602
    });
    await expect(dispatchFiles(files, "list", undefined)).rejects.toMatchObject({ code: -32_602 });
    await expect(dispatchFiles(files, "resolve", { path: "a" })).rejects.toMatchObject({
      code: -32_601
    });
    expect(files.read).not.toHaveBeenCalled();
  });

  it("rethrows a files wire error unchanged", async () => {
    const files = fakeFiles();
    const error = forbidden("../x.ts");
    files.write.mockRejectedValueOnce(error);

    await expect(dispatchFiles(files, "write", { path: "../x.ts", text: "x" })).rejects.toBe(error);
  });
});

describe("files channel over a tools socket", () => {
  it("answers each method with the files result", async () => {
    const { harness, tools, files } = setup();

    harness.send(tools, request(1, "files", "list", { dir: "" }));
    harness.send(tools, request(2, "files", "read", { path: "src/a.ts" }));
    harness.send(tools, request(3, "files", "write", { path: "src/a.ts", text: "x" }));
    harness.send(
      tools,
      request(4, "files", "writeBinary", { path: ".moku/captures/a.png", data: PNG })
    );
    harness.send(tools, request(5, "files", "readBinary", { path: ".moku/captures/a.png" }));
    harness.send(tools, request(6, "files", "find", { key: "node:board/merge" }));
    await flush();

    expect(resultOf(tools, 1)).toEqual([{ path: "src/a.ts", kind: "file", size: 3 }]);
    expect(resultOf(tools, 2)).toEqual({ text: "abc", version: "v1" });
    expect(resultOf(tools, 3)).toEqual({ path: "src/a.ts", bytes: 1, version: "v2" });
    expect(resultOf(tools, 4)).toEqual({ path: ".moku/captures/a.png", bytes: 8, version: "v3" });
    expect(resultOf(tools, 5)).toEqual({ dataUrl: "data:image/png;base64,AA==", version: "v4" });
    expect(resultOf(tools, 6)).toMatchObject([{ path: "nodes/merge.ts", line: 17 }]);
    expect(files.list).toHaveBeenCalledWith("");
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("answers a find without a key with -32602", async () => {
    const { harness, tools } = setup();

    harness.send(tools, request(1, "files", "find", {}));
    await flush();

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_602, data: { field: "key" } });
  });

  it("passes a files wire error through with its code, data and message (H33)", async () => {
    const { harness, tools, files } = setup();
    files.write.mockRejectedValueOnce(forbidden("../x.ts"));

    harness.send(tools, request(1, "files", "write", { path: "../x.ts", text: "x" }));
    await flush();

    expect(errorOf(tools, 1)).toEqual({
      code: -32_004,
      message: "[moku-editor] forbidden path: ../x.ts",
      data: { reason: "forbidden_path", retryable: false, id: "../x.ts" }
    });
  });

  it("turns any other throw into -32000 with the message only, no stack (H39)", async () => {
    const { harness, tools, files } = setup();
    files.read.mockRejectedValueOnce(new Error("disk on fire"));
    files.list.mockImplementationOnce(() => {
      throw new TypeError("sync boom");
    });

    harness.send(tools, request(1, "files", "read", { path: "src/a.ts" }));
    harness.send(tools, request(2, "files", "list", { dir: "" }));
    await flush();

    expect(errorOf(tools, 1)).toEqual({
      code: -32_000,
      message: "[moku-editor] disk on fire",
      data: { reason: "command_failed", retryable: false }
    });
    expect(errorOf(tools, 2)).toMatchObject({ code: -32_000, message: "[moku-editor] sync boom" });
    expect(tools.sent.join("")).not.toContain("stack");
    expect(tools.sent.join("")).not.toContain("at ");
  });

  it("keeps a wireError built by the protocol", async () => {
    const { harness, tools, files } = setup();
    files.read.mockRejectedValueOnce(
      wireError(-32_005, "version conflict: a.ts", { reason: "version_conflict", retryable: false })
    );

    harness.send(tools, request(1, "files", "read", { path: "a.ts" }));
    await flush();

    expect(errorOf(tools, 1)).toMatchObject({
      code: -32_005,
      data: { reason: "version_conflict" }
    });
  });
});
