import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** No axe violations at WCAG 2.2 AA. Its "needs review" results don't fail the check. */
export async function checkAxe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (violations.length === 0) return;
  const lines = violations.flatMap((v) => [
    `  ${v.id} (${v.impact ?? "unknown impact"}): ${v.help}`,
    ...v.nodes.slice(0, 5).map((n) => `    ${n.target.join(" ")}`),
  ]);
  throw new Error(`axe violations:\n${lines.join("\n")}`);
}
