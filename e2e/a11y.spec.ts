/**
 * @file axe WCAG 2.1 AA scan of each workspace on desktop, in the dark and in the light theme.
 * Every violation is attached to the report; serious and critical ones fail the test. The game
 * iframe is the game, not the tools page, so it is excluded. The light run switches the OS scheme,
 * which the workspace follows while no theme was chosen with the toggle.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, WORKSPACES } from "./fixtures";

const THEMES = ["dark", "light"] as const;

test.describe("a11y", () => {
  test.skip(({ isMobile }) => isMobile, "axe runs on desktop");

  for (const theme of THEMES) {
    for (const { id, label } of WORKSPACES) {
      test(`${label} workspace (${theme}) has no serious or critical axe violation`, async ({
        tools
      }, testInfo) => {
        await tools.page.emulateMedia({ colorScheme: theme });
        await expect(tools.page.locator("html")).toHaveAttribute("data-theme", theme);
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
          targets: violation.nodes.slice(0, 5).map(node => node.target.join(" ")),
          details: violation.nodes.slice(0, 5).map(node => node.failureSummary ?? "")
        }));
        await testInfo.attach(`axe-${id}-${theme}.json`, {
          body: JSON.stringify(summary, undefined, 2),
          contentType: "application/json"
        });
        for (const item of summary) {
          console.info(
            `[axe ${id} ${theme}] ${item.impact} ${item.id} ×${item.nodes}: ${item.help}\n  ${item.targets.join("\n  ")}\n  ${item.details.join("\n  ").replaceAll("\n", " ")}`
          );
        }
        const blocking = summary.filter(
          item => item.impact === "serious" || item.impact === "critical"
        );
        expect(blocking).toEqual([]);
      });
    }
  }
});
