import { afterEach, describe, expect, it } from "vitest";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { createCtx, deviceSession, directoryOf, localSession, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Markers and names (spec 11 § 4 markers, B9): at most config.markers kept,
// and a device is named by the marketing name the directory matched.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource.markers", () => {
  it("keeps at most config.markers, dropping the oldest", async () => {
    const { ctx, link } = createCtx({ markers: 2, autoUse: false });
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");

    await api.useDevice("s-9");
    await api.useLocal();
    await api.useDevice("s-9");

    expect(api.markers().map(marker => marker.label)).toEqual([
      "Switched to the local preview",
      "Switched to SM-A266B"
    ]);
  });

  it("names the device by the directory's marketing name when matched", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.devices = directoryOf();

    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    expect(api.markers().at(-1)?.label).toBe("Galaxy A26 connected");
    expect(api.label()).toEqual({
      name: "Galaxy A26",
      model: "SM-A266B",
      kind: "device",
      link: { kind: "wire", transport: "adb", address: "127.0.0.1" }
    });
  });

  it("returns a copy: a reader cannot change the markers", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    const read = api.markers() as unknown[];
    read.length = 0;

    expect(api.markers()).toHaveLength(1);
  });
});
