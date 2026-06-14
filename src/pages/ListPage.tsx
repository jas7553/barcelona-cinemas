import { useMemo } from "react";
import MainList from "../views/MainList";
import { ThemeProvider } from "../context/ThemeContext";
import { useNow } from "../hooks/useClient";
import { useLocationPin } from "../hooks/useLocationPin";
import { transformResponse } from "../utils";
import type { Listings } from "../types";

export interface ListPageData {
  /** Instant the page was pre-rendered (SSG); seeds the hydration clock. */
  renderedAt: string;
  listings: Listings;
}

/**
 * Document root for `/`. Replaces the old SPA App shell: owns the embedded
 * listings payload, the shared clock, and geolocation, then renders MainList.
 */
export default function ListPage({ data }: { data: ListPageData }) {
  const now = useNow(data.renderedAt);
  const movies = useMemo(() => transformResponse(data.listings, now), [data.listings, now]);
  const { coords, active, error, resolving, toggle } = useLocationPin();

  return (
    <ThemeProvider>
      <div className="app-wrapper">
        <div className="app-shell">
          <main className="screen">
            <MainList
              movies={movies}
              generatedAt={data.listings.generated_at}
              stale={data.listings.stale}
              now={now}
              coords={coords}
              locationActive={active}
              locationError={error}
              locationResolving={resolving}
              onToggleLocation={toggle}
            />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
