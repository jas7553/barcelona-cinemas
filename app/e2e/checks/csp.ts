import type { Page } from "@playwright/test";

export interface CspWatch {
  /** Throws on any violation, or if the page wasn't served under a strict CSP. */
  check(): void;
}

/**
 * Records `securitypolicyviolation` events from now on, and each document's
 * CSP header. Zero violations only means something under a policy, so every
 * document must carry one whose scripts are not `unsafe-inline` or
 * `unsafe-eval`.
 */
export async function watchCsp(page: Page): Promise<CspWatch> {
  const problems: string[] = [];
  page.on("response", (response) => {
    if (!response.request().isNavigationRequest()) return;
    const policy = response.headers()["content-security-policy"];
    if (!policy) {
      problems.push(`no Content-Security-Policy header on ${response.url()}`);
      return;
    }
    const directives = policy.split(";").map((d) => d.trim());
    const named = (name: string) => directives.find((d) => d.startsWith(`${name} `));
    const scripts = named("script-src") ?? named("default-src");
    if (!scripts || /'unsafe-(inline|eval)'/.test(scripts)) {
      problems.push(`scripts aren't restricted on ${response.url()}: ${policy}`);
    }
  });
  await page.exposeFunction("__e2eCspViolation", (violation: string) => {
    problems.push(violation);
  });
  await page.addInitScript(() => {
    const report = (window as unknown as { __e2eCspViolation: (v: string) => void })
      .__e2eCspViolation;
    document.addEventListener("securitypolicyviolation", (e) => {
      report(`${e.effectiveDirective} blocked ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`);
    });
  });

  return {
    check() {
      if (problems.length > 0) throw new Error(`CSP:\n  ${problems.join("\n  ")}`);
    },
  };
}
