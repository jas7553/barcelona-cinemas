import type { Page } from "@playwright/test";

/**
 * No dot or bullet joins facts (brief, principle 11): not in the rendered text
 * and not in `::before`/`::after` content. Covers · and •, plus the lookalikes
 * a renderer might reach for: ∙ ⋅ ‧ ・ ･. A · between two l's is the Catalan
 * punt volat (il·lusió, COL·LECCIÓ), a letter, and passes. List markers are
 * not text, so they pass.
 */
export async function checkNoSeparators(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const DOTS = /[•∙⋅‧・･]|·(?![lL])|(?<![lL])·/gu;
    const found: string[] = [];
    const text = document.body.innerText;
    for (const match of text.matchAll(DOTS)) {
      found.push(`"${text.slice(Math.max(0, match.index - 20), match.index + 20).trim()}"`);
    }
    for (const el of document.body.querySelectorAll("*")) {
      for (const pseudo of ["::before", "::after"]) {
        const content = getComputedStyle(el, pseudo).content;
        if (content.search(DOTS) !== -1) found.push(`${el.localName}${pseudo} content ${content}`);
      }
    }
    return found;
  });
  if (problems.length > 0) {
    throw new Error(`separators in the text:\n  ${problems.slice(0, 10).join("\n  ")}`);
  }
}
