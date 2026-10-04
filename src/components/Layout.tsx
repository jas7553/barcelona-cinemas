import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { usePrefs } from "../client/prefs";
import type { PageBase } from "../pageData";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { HomeSheet } from "./HomeSheet";

interface Props {
  data: PageBase;
  now: Date;
  section?: "cinemas";
  /** The page's title block, rendered inside the header under the bar. */
  heading?: ComponentChildren;
  children: ComponentChildren;
}

export function Layout({ data, now, section, heading, children }: Props) {
  const { home } = usePrefs();
  const [homeOpen, setHomeOpen] = useState(false);
  return (
    <>
      <Header section={section} onHome={() => setHomeOpen(true)}>
        {heading}
      </Header>
      <main class="wrap">{children}</main>
      <Footer generatedAt={data.generatedAt} now={now} />
      {homeOpen && <HomeSheet home={home} onClose={() => setHomeOpen(false)} />}
    </>
  );
}
