import type { PageData } from "./pageData";
import { DayPage } from "./pages/DayPage";
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
    case "privacy":
      return <PrivacyPage data={data} />;
    case "not-found":
      return <NotFoundPage data={data} />;
  }
}
