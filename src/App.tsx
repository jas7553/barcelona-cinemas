import type { PageData } from "./pageData";
import { CinemaPage } from "./pages/CinemaPage";
import { CinemasPage } from "./pages/CinemasPage";
import { DayPage } from "./pages/DayPage";
import { FilmPage } from "./pages/FilmPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { WeekPage } from "./pages/WeekPage";

/** The page for a payload. The server render and client hydration both start here. */
export function App({ data }: { data: PageData }) {
  switch (data.page) {
    case "week":
      return <WeekPage data={data} />;
    case "day":
      return <DayPage data={data} />;
    case "film":
      return <FilmPage data={data} />;
    case "cinema":
      return <CinemaPage data={data} />;
    case "cinemas":
      return <CinemasPage data={data} />;
    case "privacy":
      return <PrivacyPage data={data} />;
    case "not-found":
      return <NotFoundPage data={data} />;
  }
}
