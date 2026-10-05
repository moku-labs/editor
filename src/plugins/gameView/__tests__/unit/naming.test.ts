/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it } from "vitest";
import {
  capturePath,
  cardPath,
  deviceLabel,
  folderOf,
  imageExtension,
  nodeOf,
  pickPaths,
  plannedShots,
  positionOf,
  seriesFolder,
  shotName,
  stamp,
  takenPaths
} from "../../capture/naming";

describe("stamp", () => {
  it("prints the local date and minute as yyyy-mm-dd-hhmm", () => {
    expect(stamp(new Date(2026, 8, 24, 10, 12, 59))).toBe("2026-09-24-1012");
    expect(stamp(new Date(2026, 0, 2, 3, 4))).toBe("2026-01-02-0304");
  });
});

describe("capturePath", () => {
  it("names the PNG after the stamp and the node", () => {
    expect(capturePath(".moku/captures", "2026-09-24-1012", "board", new Set())).toBe(
      ".moku/captures/2026-09-24-1012-board.png"
    );
  });

  it("appends -2, -3 … when the minute and node are taken", () => {
    const taken = new Set([
      ".moku/captures/2026-09-24-1012-board.png",
      ".moku/captures/2026-09-24-1012-board-2.png"
    ]);
    expect(capturePath(".moku/captures", "2026-09-24-1012", "board", taken)).toBe(
      ".moku/captures/2026-09-24-1012-board-3.png"
    );
  });

  it("keeps the name to letters, digits, - and _", () => {
    expect(capturePath(".moku/captures", "2026-09-24-1012", "board/merge it", new Set())).toBe(
      ".moku/captures/2026-09-24-1012-board-merge-it.png"
    );
  });
});

describe("capturePath with the extension of the picture (D-34)", () => {
  it("names a JPEG shot .jpg and keeps the -2 rule per extension", () => {
    expect(capturePath(".moku/captures", "2026-09-24-1012", "board", new Set(), "jpg")).toBe(
      ".moku/captures/2026-09-24-1012-board.jpg"
    );
    const taken = new Set([".moku/captures/2026-09-24-1012-board.jpg"]);
    expect(capturePath(".moku/captures", "2026-09-24-1012", "board", taken, "jpg")).toBe(
      ".moku/captures/2026-09-24-1012-board-2.jpg"
    );
  });
});

describe("imageExtension", () => {
  it("is jpg for a JPEG data URL and the subtype for the others", () => {
    expect(imageExtension("data:image/jpeg;base64,/9j/")).toBe("jpg");
    expect(imageExtension("data:image/png;base64,iVBOR")).toBe("png");
    expect(imageExtension("data:image/webp;base64,UklG")).toBe("webp");
  });

  it("is png for anything that is no image data URL", () => {
    expect(imageExtension("")).toBe("png");
    expect(imageExtension("data:text/plain,hi")).toBe("png");
  });
});

describe("pickPaths (A19)", () => {
  it("names the crop <name>-f<frame>-crop and the full frame f<frame>-full, with the picture's extension", () => {
    expect(
      pickPaths(".moku/captures", "settingsBoard", 1841, new Set(), { crop: "jpg", full: "jpg" })
    ).toEqual({
      crop: ".moku/captures/settingsBoard-f1841-crop.jpg",
      full: ".moku/captures/f1841-full.jpg"
    });
    expect(
      pickPaths(".moku/captures", "board.items/3", 7, new Set(), { crop: "jpg", full: "png" })
    ).toEqual({
      crop: ".moku/captures/board-items-3-f7-crop.jpg",
      full: ".moku/captures/f7-full.png"
    });
  });

  it("appends -2 before the suffix when a file is taken", () => {
    const taken = new Set([
      ".moku/captures/area-f25-crop.jpg",
      ".moku/captures/f25-full.jpg",
      ".moku/captures/f25-2-full.jpg"
    ]);
    expect(pickPaths(".moku/captures", "area", 25, taken, { crop: "jpg", full: "jpg" })).toEqual({
      crop: ".moku/captures/area-f25-2-crop.jpg",
      full: ".moku/captures/f25-3-full.jpg"
    });
  });
});

describe("cardPath (round 2b R13)", () => {
  it("is <dir>/<name>-f<frame>.md, -2 when taken, unsafe characters as -", () => {
    expect(cardPath(".moku/captures", "settingsBoard", 25, new Set())).toBe(
      ".moku/captures/settingsBoard-f25.md"
    );
    expect(
      cardPath(
        ".moku/captures",
        "settingsBoard",
        25,
        new Set([".moku/captures/settingsBoard-f25.md"])
      )
    ).toBe(".moku/captures/settingsBoard-f25-2.md");
    expect(cardPath(".moku/captures", "board.items/3", 7, new Set())).toBe(
      ".moku/captures/board-items-3-f7.md"
    );
  });
});

describe("seriesFolder", () => {
  it("is series-<stamp>/ with a trailing slash, -2 on a collision", () => {
    expect(seriesFolder(".moku/captures", "2026-09-24-1015", new Set())).toBe(
      ".moku/captures/series-2026-09-24-1015/"
    );
    expect(
      seriesFolder(
        ".moku/captures",
        "2026-09-24-1015",
        new Set([".moku/captures/series-2026-09-24-1015"])
      )
    ).toBe(".moku/captures/series-2026-09-24-1015-2/");
  });
});

describe("shotName", () => {
  it("zero-pads to max(3, digits of the count), counting from 1", () => {
    expect(shotName(0, 4)).toBe("001.png");
    expect(shotName(19, 20)).toBe("020.png");
    expect(shotName(0, 1250)).toBe("0001.png");
  });
});

describe("positionOf and nodeOf", () => {
  it("reads path, flow and node of a game.position value", () => {
    const position = positionOf({
      path: "board/awaitIntent",
      flow: "board",
      node: "awaitIntent",
      waiting: []
    });
    expect(position).toEqual({ path: "board/awaitIntent", flow: "board", node: "awaitIntent" });
    expect(nodeOf(position)).toBe("board");
  });

  it("falls back to game without a flow", () => {
    expect(positionOf(null)).toEqual({});
    expect(positionOf({ path: 3 })).toEqual({});
    expect(nodeOf({})).toBe("game");
  });
});

describe("small helpers", () => {
  it("folderOf keeps the folder with its slash", () => {
    expect(folderOf(".moku/captures/series-2026-09-24-1015/index.json")).toBe(
      ".moku/captures/series-2026-09-24-1015/"
    );
    expect(folderOf("index.json")).toBe("");
  });

  it("plannedShots is floor(duration / interval)", () => {
    expect(plannedShots(2000, 100)).toBe(20);
    expect(plannedShots(1000, 16)).toBe(62);
    expect(plannedShots(1000, 0)).toBe(0);
  });

  it("deviceLabel and takenPaths", () => {
    expect(deviceLabel("iPhone 15", "portrait")).toBe("iPhone 15 portrait");
    expect(takenPaths([{ path: "a/b.png", kind: "file", size: 1 }])).toEqual(new Set(["a/b.png"]));
  });
});
