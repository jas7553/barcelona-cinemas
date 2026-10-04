import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { usePrefs } from "../client/prefs";
import type { PageBase } from "../pageData";
import type { Theater } from "../types";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { HomeSheet } from "./HomeSheet";

interface Props {
  data: PageBase & { theaters: Theater[] };
  now: Date;
  section?: "cinemas";
  /** The page's title block, rendered inside the header under the bar. */
  heading?: ComponentChildren;
  /** Full-width bar between the header and the content: the list pages' sticky day strip. */
  strip?: ComponentChildren;
  children: ComponentChildren;
}

export function Layout({ data, now, section, heading, strip, children }: Props) {
  const { home } = usePrefs();
  const [homeOpen, setHomeOpen] = useState(false);
  return (
    <>
      <Header section={section} onHome={() => setHomeOpen(true)}>
        {heading}
      </Header>
      {strip}
      <main class="wrap">{children}</main>
      <Footer generatedAt={data.generatedAt} now={now} />
      {homeOpen && <HomeSheet home={home} theaters={data.theaters} onClose={() => setHomeOpen(false)} />}
    </>
  );
}
