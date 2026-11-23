import type { Page } from "@playwright/test";

const TMDB = "https://image.tmdb.org";

export interface NetworkWatch {
  /** Throws if any request left the allowed origins or a subresource failed. */
  check(): void;
}

/**
 * Records every request from now on. Allowed: the site's own origin and
 * TMDb's image host. Anything else fails, whether it went out or was blocked:
 * a browser that blocks a request under the CSP may never report it as one,
 * so blocked URLs from `securitypolicyviolation` count too. A failed or 4xx/5xx
 * subresource from an allowed origin also fails (the document itself may be a
 * 404 page).
 */
export async function watchNetwork(page: Page, siteOrigin: string): Promise<NetworkWatch> {
  const allowed = new Set([siteOrigin, TMDB]);
  const foreign = new Set<string>();
  const broken: string[] = [];
  const note = (url: string) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    const origin = URL.canParse(url) ? new URL(url).origin : url;
    if (!allowed.has(origin)) foreign.add(url);
  };

  page.on("request", (request) => {
    note(request.url());
  });
  page.on("requestfailed", (request) => {
    if (allowed.has(new URL(request.url()).origin)) {
      broken.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (response.request().isNavigationRequest() || response.status() < 400) return;
    broken.push(`${response.url()}: ${response.status()}`);
  });
  await page.exposeFunction("__e2eBlockedUrl", note);
  await page.addInitScript(() => {
    const report = (window as unknown as { __e2eBlockedUrl: (url: string) => void })
      .__e2eBlockedUrl;
    document.addEventListener("securitypolicyviolation", (e) => {
      if (/^https?:/.test(e.blockedURI)) report(e.blockedURI);
    });
  });

  return {
    check() {
      const problems = [
        ...[...foreign].map((url) => `not allowed: ${url}`),
        ...broken.map((b) => `failed: ${b}`),
      ];
      if (problems.length > 0) throw new Error(`network:\n  ${problems.join("\n  ")}`);
    },
  };
}
