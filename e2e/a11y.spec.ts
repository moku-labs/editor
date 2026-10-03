/**
 * @file axe WCAG 2.1 AA scan of each workspace on desktop. Every violation is attached to the
 * report; serious and critical ones fail the test. The game iframe is the game, not the tools
 * page, so it is excluded.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, WORKSPACES } from "./fixtures";

test.describe("a11y", () => {
  test.skip(({ isMobile }) => isMobile, "axe runs on desktop");

  for (const { id, label } of WORKSPACES) {
    test(`${label} workspace has no serious or critical axe violation`, async ({
      tools
    }, testInfo) => {
      await tools.show(id);
      await tools.settle();
      const results = await new AxeBuilder({ page: tools.page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude("iframe[data-game-frame]")
        .analyze();
      const summary = results.violations.map(violation => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 5).map(node => node.target.join(" "))
      }));
      await testInfo.attach(`axe-${id}.json`, {
        body: JSON.stringify(summary, undefined, 2),
        contentType: "application/json"
      });
      for (const item of summary) {
        console.info(`[axe ${id}] ${item.impact} ${item.id} ×${item.nodes}: ${item.help}`);
      }
      const blocking = summary.filter(
        item => item.impact === "serious" || item.impact === "critical"
      );
      expect(blocking).toEqual([]);
    });
  }
});
