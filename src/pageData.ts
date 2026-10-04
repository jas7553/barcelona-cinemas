/** Fields every page's embedded payload carries. */
export interface PageBase {
  /** The instant the page was rendered; seeds the clock for hydration. */
  renderedAt: string;
  /** When the listings were fetched (public `generated_at`). */
  generatedAt: string;
  /** The refresh fell back to cached listings. */
  stale: boolean;
}

export type PageData = PageBase & ({ page: "privacy" } | { page: "not-found" });

export type PageName = PageData["page"];
