import { useState } from "preact/hooks";
import { useNow } from "../client/clock";
import { forgetAll } from "../client/prefs";
import { Layout } from "../components/Layout";
import type { PageBase } from "../pageData";
import type { Theater } from "../types";

export function PrivacyPage({ data }: { data: PageBase & { theaters: Theater[] } }) {
  const now = useNow(data.renderedAt);
  const [forgotten, setForgotten] = useState(false);
  return (
    <Layout
      data={data}
      now={now}
      heading={
        <div class="title">
          <h1 class="display">Privacy</h1>
        </div>
      }
    >
      <div class="prose">
        <p>No accounts, no cookies, no analytics, no tracking.</p>
        <h2>Kept on this device only</h2>
        <ul>
          <li>
            <b>Home</b>: the point distances are measured from.
          </li>
          <li>
            <b>Seen films</b>: so they move out of the way.
          </li>
          <li>
            <b>My cinemas</b>: your starred cinemas.
          </li>
        </ul>
        <p>
          On iPhone, Safari clears it if you don't open the site for 7 days. Add the site to your Home Screen (Share,
          then Add to Home Screen) and it stays.
        </p>
        <p>None of it is sent anywhere. Clearing this site's data in your browser removes it, or:</p>
        <button
          type="button"
          class="pill"
          onClick={() => {
            forgetAll();
            setForgotten(true);
          }}
        >
          Forget all of it
        </button>
        <p class="sub" role="status">
          {forgotten ? "Done. Nothing is stored on this device now." : ""}
        </p>
        <h2>Your location</h2>
        <p>
          Only used when you tap “Use my current location”, to set Home. Your browser asks first, and the position
          stays on this device.
        </p>
        <h2>Other services</h2>
        <p>
          Posters and backdrops load from TMDb, which sees your IP address as any website would. Booking, website and
          directions links take you to the cinema's site or your maps app.
        </p>
        <p class="tmdb">
          <a href="https://www.themoviedb.org/" aria-label="The Movie Database">
            <img src="/tmdb-logo.svg" alt="" width={70} height={10} />
          </a>
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </Layout>
  );
}
