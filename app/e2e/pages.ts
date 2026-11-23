/**
 * Every page × state the checks run on. A new entry gets every check, every
 * width, a shot and a budget line; nothing else needs registering.
 */
export interface PageEntry {
  /** Names the test and the shot: `shots/<page>-<state>-<width>.png`. */
  readonly page: string;
  readonly state: string;
  readonly path: string;
  /** What must work with JavaScript off (checks/no-js.ts). */
  readonly noJs: { readonly listings: boolean; readonly filterForm: boolean };
}

export const PAGES: readonly PageEntry[] = [
  { page: "week", state: "stub", path: "/", noJs: { listings: true, filterForm: true } },
  {
    page: "film",
    state: "stub",
    path: "/film/the-stub-film",
    noJs: { listings: true, filterForm: false },
  },
];

/** Where the Back flows go before coming back: another registered page. */
export function awayFrom(entry: PageEntry): string {
  const other = PAGES.find((p) => p.path !== entry.path);
  if (!other) throw new Error("the Back flows need two registered pages with different paths");
  return other.path;
}
