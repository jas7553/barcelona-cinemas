import { describe, expect, it } from "vitest";
import { renderPage, sitePages } from "./entry-server";
import type { Listings } from "./types";

const listings: Listings = { generated_at: "2026-10-04T08:19:00Z", stale: false, theaters: [], movies: [] };
const renderedAt = "2026-10-04T10:19:00Z";

function page(name: string) {
  const found = sitePages(listings, renderedAt).find((p) => p.data.page === name);
  if (!found) throw new Error(`no ${name} page`);
  return found;
}

describe("sitePages", () => {
  it("carries the listings' age into every payload", () => {
    for (const { data } of sitePages(listings, renderedAt)) {
      expect(data).toMatchObject({ renderedAt, generatedAt: listings.generated_at, stale: false });
    }
  });

  it("writes the 404 where CloudFront's error response expects it", () => {
    expect(page("not-found").path).toBe("404.html");
  });
});

describe("renderPage", () => {
  it("renders Privacy with a trailing-slash canonical URL", () => {
    const out = renderPage(page("privacy").data, "https://example.com");
    expect(out.title).toBe("Privacy · Barcelona This Week");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/privacy/"');
    expect(out.headExtra).not.toContain("noindex");
    expect(out.html).toContain("Forget all of it");
  });

  it("renders the 404 as noindex with no canonical", () => {
    const out = renderPage(page("not-found").data, "https://example.com");
    expect(out.html).toContain("Not showing.");
    expect(out.headExtra).toContain('name="robots" content="noindex"');
    expect(out.headExtra).not.toContain("canonical");
  });

  it("states the data age against the render instant, so hydration matches", () => {
    expect(renderPage(page("privacy").data).html).toContain("Updated 2 h ago");
  });

  it("puts both Home pill labels in the markup for the pre-paint CSS to choose between", () => {
    const { html } = renderPage(page("privacy").data);
    expect(html).toContain('<span class="if-home">Home</span>');
    expect(html).toContain('<span class="if-no-home">Set home</span>');
  });

  it("never emits a style attribute, which the CSP would block", () => {
    for (const { data } of sitePages(listings, renderedAt)) {
      expect(renderPage(data).html).not.toMatch(/\sstyle=/);
    }
  });
});
