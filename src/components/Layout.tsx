import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { usePrefs, useSettledOrder } from "../client/prefs";
import type { PageBase } from "../pageData";
import type { Theater } from "../types";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { HomeSheet } from "./HomeSheet";

interface Props {
  data: PageBase & { theaters: Theater[] };
  section?: "cinemas";
  /** The page's title block, rendered inside the header under the bar. */
  heading?: ComponentChildren;
  /** Full-width bar between the header and the content: the list pages' day strip, the film page's backdrop. */
  strip?: ComponentChildren;
  /** Extra class on `<main>`, for a page that lays its content out itself. */
  mainClass?: string;
  children: ComponentChildren;
}

export function Layout({ data, section, heading, strip, mainClass, children }: Props) {
  const prefs = usePrefs();
  useSettledOrder(prefs);
  const [homeOpen, setHomeOpen] = useState(false);
  return (
    <>
      <Header section={section} onHome={() => setHomeOpen(true)}>
        {heading}
      </Header>
      {strip}
      <main class={mainClass ? `wrap ${mainClass}` : "wrap"}>{children}</main>
      <Footer generatedAt={data.generatedAt} />
      {homeOpen && <HomeSheet home={prefs.home} theaters={data.theaters} onClose={() => setHomeOpen(false)} />}
    </>
  );
}
