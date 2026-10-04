import type { PageData } from "./pageData";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";

/** The page for a payload. The server render and client hydration both start here. */
export function App({ data }: { data: PageData }) {
  switch (data.page) {
    case "privacy":
      return <PrivacyPage data={data} />;
    case "not-found":
      return <NotFoundPage data={data} />;
  }
}
