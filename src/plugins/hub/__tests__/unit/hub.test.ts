/* eslint-disable sonarjs/no-clear-text-protocols -- the hub serves plain http on 127.0.0.1 */
import { describe, expect, it } from "vitest";
import { createServerCore, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../..";

describe("hub plugin wiring", () => {
  it("is named hub and depends on files", () => {
    expect(hubPlugin.name).toBe("hub");
    expect(hubPlugin.spec.depends).toEqual([filesPlugin]);
  });

  it("has the spec defaults", () => {
    const app = createServerCore(serverCoreConfig, {
      plugins: [filesPlugin, hubPlugin]
    }).createApp();

    expect(app.hub.path()).toBe("/__editor");
    expect(app.hub.sessions()).toEqual([]);
  });

  it("fails createApp early on a bad config (onInit)", () => {
    const framework = createServerCore(serverCoreConfig, { plugins: [filesPlugin, hubPlugin] });

    expect(() => framework.createApp({ pluginConfigs: { hub: { path: "/x/" } } })).toThrow(
      /^\[moku-editor] hub\.path /
    );
    expect(() =>
      framework.createApp({ pluginConfigs: { hub: { allow: ["http://evil.com/"] } } })
    ).toThrow(/^\[moku-editor] hub\.allow /);
  });
});
