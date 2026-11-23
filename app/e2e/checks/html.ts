import { HtmlValidate } from "html-validate";

/**
 * Conformance plus html-validate's accessibility and document rules (heading
 * levels, dangling ARIA references). Formatting is the renderer's business, so
 * the style rules Prettier disagrees with are off. `role="list"` is allowed:
 * Safari drops list semantics from a `list-style: none` list without it.
 */
const validator = new HtmlValidate({
  extends: ["html-validate:recommended", "html-validate:document", "html-validate:prettier"],
  rules: {
    "no-redundant-role": ["error", { exclude: ["list"] }],
    "require-sri": ["error", { target: "crossorigin" }],
  },
});

/** Validates the HTML as served, before any script runs. */
export async function checkHtml(html: string): Promise<void> {
  const report = await validator.validateString(html);
  const problems = report.results.flatMap((r) =>
    r.messages.map((m) => `  ${m.line}:${m.column} ${m.ruleId}: ${m.message}`),
  );
  if (problems.length > 0) throw new Error(`invalid HTML:\n${problems.join("\n")}`);
}
