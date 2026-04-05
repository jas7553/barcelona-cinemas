/**
 * ============================================================================
 * BCNcinemas — Complete Redesign Prototype
 * ============================================================================
 *
 * DESIGN DIRECTION: "Editorial warmth"
 * Inspired by: Curzon's clean film listings, Letterboxd's browse UX,
 * MUBI's curatorial confidence, Fandango's genre filtering, and
 * Metrograph's tasteful typography.
 *
 * KEY DEPARTURE FROM V1:
 * The dark cinema UI is replaced with a warm, light theme that feels
 * more like a curated magazine or guidebook than a ticketing terminal.
 * The dark theme was incidental — the site isn't a cinema chain's
 * booking system, it's a personal discovery tool. Light themes
 * are easier to read in daylight (cafés, transit) where this site
 * is most likely used on mobile.
 *
 * ============================================================================
 * ARCHITECTURE NOTES FOR CLAUDE CODE
 * ============================================================================
 *
 * PAGE STRUCTURE:
 * The site has TWO primary views, toggled in the nav:
 *
 *   1. DISCOVER (/films)
 *      "What should I watch?" — film catalog with poster grid,
 *      genre filtering, sorting, and expandable detail cards.
 *      This is the NEW view and the default landing page.
 *
 *   2. SHOWTIMES (/showtimes)
 *      "Where and when?" — the existing showtime listing, restyled.
 *      Users land here after tapping "See showtimes →" on a film card,
 *      or navigate directly. Keeps the current data model.
 *
 * ROUTING:
 *   /              → redirects to /films
 *   /films         → Discover view (this prototype)
 *   /films?genre=Horror&sort=rating → filtered/sorted state
 *   /film/:slug    → (future) single-film detail page
 *   /showtimes     → showtime listing (current site, restyled)
 *
 * RESPONSIVE STRATEGY:
 *   Mobile  (<640px):  Single column, full-width cards
 *   Tablet  (640-1024): 2-column poster grid
 *   Desktop (>1024):   3-column poster grid, sidebar filters
 *
 * DATA: Same backend scraper. The Discover view needs a derived
 * endpoint or pre-computed fields:
 *   - theaterCount, screeningCount (aggregated from showtimes)
 *   - isNewRelease (year === currentYear)
 *   - isLimitedRun (screeningCount <= 3)
 *   - isLastChance (lastShowtime is within 48 hours)
 *   - availableDays (["Today","Tomorrow","Tue",...]) for badge display
 *
 * THEME SYSTEM:
 *   Implement with CSS custom properties so a dark mode toggle is
 *   trivial to add later. All colors below reference --var names.
 *
 * ============================================================================
 */

import { useState, useMemo, useRef } from "react";

// ─── Design Tokens ──────────────────────────────────────────────────────────
const theme = {
  bg: "#FAFAF8",
  bgCard: "#FFFFFF",
  bgCardHover: "#F7F6F3",
  bgMuted: "#F2F1ED",
  bgAccent: "#FFF8EE",
  border: "#E8E6E1",
  borderLight: "#F0EEEA",
  text: "#1A1A1A",
  textSecondary: "#6B6560",
  textMuted: "#9C9790",
  accent: "#D4622B",       // warm terracotta — not the typical blue or amber
  accentHover: "#BF5523",
  accentSoft: "#FEF0E7",
  green: "#2D7D46",
  greenSoft: "#EDFAEF",
  purple: "#6B4FBB",
  purpleSoft: "#F3F0FF",
  red: "#C4391D",
  redSoft: "#FFF0ED",
  gold: "#B8860B",
  goldSoft: "#FFF9E6",
  shadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
  shadowHover: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  radius: 12,
  radiusSm: 8,
  font: '"Source Serif 4", "Georgia", "Times New Roman", serif',
  fontSans: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

// ─── Film Data ──────────────────────────────────────────────────────────────
const FILMS = [
  {
    id: "project-hail-mary", title: "Project Hail Mary", year: 2026,
    runtime: "2h 37m", rating: 8.2, genres: ["Sci-Fi", "Adventure"],
    description: "Science teacher Ryland Grace wakes up on a spaceship light years from home with no recollection of who he is or how he got there. As his memory returns, he begins to uncover his mission: solve the riddle of the mysterious substance causing the sun to die out.",
    imdbUrl: "#", theaterCount: 11, screeningCount: 58,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
  {
    id: "i-swear", title: "I Swear", year: 2025,
    runtime: "2h 1m", rating: 8.4, genres: ["Drama", "History"],
    description: "Diagnosed with Tourette Syndrome at 15, John Davidson navigates his way against the odds through troubled teenage years and into adulthood, finding inspiration in the kindness of others to discover his true purpose in life.",
    imdbUrl: "#", theaterCount: 2, screeningCount: 4,
    isNewRelease: false, isLimitedRun: true, isLastChance: false,
    availableDays: ["Tue", "Thu"],
  },
  {
    id: "epic-elvis", title: "EPiC: Elvis Presley in Concert", year: 2026,
    runtime: "1h 38m", rating: 8.3, genres: ["Music", "Documentary"],
    description: "Long-lost footage from Elvis Presley's legendary Las Vegas residency in the 1970s woven together with rare 16mm footage and recordings of Elvis telling his side of the story.",
    imdbUrl: "#", theaterCount: 1, screeningCount: 1,
    isNewRelease: true, isLimitedRun: true, isLastChance: true,
    availableDays: ["Tue"],
  },
  {
    id: "super-mario-galaxy", title: "The Super Mario Galaxy Movie", year: 2026,
    runtime: "1h 38m", rating: 8.0, genres: ["Family", "Animation", "Adventure"],
    description: "Having thwarted Bowser's previous plot to marry Princess Peach, Mario and Luigi now face a fresh threat in Bowser Jr., who is determined to liberate his father from captivity and restore the family legacy.",
    imdbUrl: "#", theaterCount: 10, screeningCount: 40,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  {
    id: "singin-in-the-rain", title: "Singin' in the Rain", year: 1952,
    runtime: "1h 43m", rating: 8.1, genres: ["Comedy", "Romance"],
    description: "In 1927 Hollywood, a silent film star falls for a chorus girl just as he and his paranoid screen partner struggle to make the difficult transition to talking pictures.",
    imdbUrl: "#", theaterCount: 2, screeningCount: 4,
    isNewRelease: false, isLimitedRun: true, isLastChance: false,
    availableDays: ["Thu"],
  },
  {
    id: "kill-bill", title: "Kill Bill: The Whole Bloody Affair", year: 2011,
    runtime: "4h 13m", rating: 8.0, genres: ["Action", "Crime"],
    description: "Quentin Tarantino's complete cut combining Kill Bill: Vol. 1 and Vol. 2 follows The Bride, a former assassin who awakens from a four-year coma after being shot by her mentor and lover, Bill.",
    imdbUrl: "#", theaterCount: 6, screeningCount: 8,
    isNewRelease: false, isLimitedRun: true, isLastChance: false,
    availableDays: ["Fri", "Sat"],
  },
  {
    id: "hamnet", title: "Hamnet", year: 2025,
    runtime: "2h 6m", rating: 7.7, genres: ["Drama", "Romance", "History"],
    description: "The powerful story of love and loss that inspired the creation of Shakespeare's timeless masterpiece, Hamlet.",
    imdbUrl: "#", theaterCount: 5, screeningCount: 18,
    isNewRelease: false, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
  {
    id: "ready-or-not-2", title: "Ready or Not: Here I Come", year: 2026,
    runtime: "1h 48m", rating: 7.5, genres: ["Horror", "Comedy", "Action"],
    description: "Grace discovers she's reached the next level of the nightmarish game — and this time with her estranged sister Faith at her side. Four rival families are hunting her for the throne.",
    imdbUrl: "#", theaterCount: 4, screeningCount: 12,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
  {
    id: "hoppers", title: "Hoppers", year: 2026,
    runtime: "1h 45m", rating: 7.6, genres: ["Animation", "Family", "Sci-Fi"],
    description: "Scientists discover how to 'hop' human consciousness into lifelike robotic animals. Animal lover Mabel seizes an opportunity, uncovering mysteries within the animal world beyond anything she imagined.",
    imdbUrl: "#", theaterCount: 1, screeningCount: 5,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
  {
    id: "marty-supreme", title: "Marty Supreme", year: 2025,
    runtime: "2h 30m", rating: 7.4, genres: ["Drama", "Thriller"],
    description: "Marty Mauser, a young man with a dream no one respects, goes to hell and back in pursuit of greatness.",
    imdbUrl: "#", theaterCount: 5, screeningCount: 15,
    isNewRelease: false, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
  {
    id: "wizard-kremlin", title: "The Wizard of the Kremlin", year: 2026,
    runtime: "2h 36m", rating: 6.4, genres: ["Drama"],
    description: "Amid post-Soviet chaos, a brilliant young man charts his path from artist to reality TV producer to the spin doctor of a rising KGB agent: Vladimir Putin.",
    imdbUrl: "#", theaterCount: 3, screeningCount: 9,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Thu"],
  },
  {
    id: "scream-7", title: "Scream 7", year: 2026,
    runtime: "1h 54m", rating: 5.8, genres: ["Horror", "Mystery"],
    description: "When a new Ghostface killer emerges in the quiet town where Sidney Prescott has built a new life, her darkest fears are realized as her daughter becomes the next target.",
    imdbUrl: "#", theaterCount: 2, screeningCount: 10,
    isNewRelease: true, isLimitedRun: false, isLastChance: false,
    availableDays: ["Today", "Mon", "Tue", "Wed", "Thu"],
  },
];

function getAllGenres(films) {
  const s = new Set();
  films.forEach(f => f.genres.forEach(g => s.add(g)));
  return Array.from(s).sort();
}

// ─── Poster Placeholder ─────────────────────────────────────────────────────
/**
 * IMPLEMENTATION NOTE:
 * When posterUrl is available, render an <img> with loading="lazy".
 * When null, render this gradient placeholder derived from the title.
 * Use TMDb w300 for grid cards, w500 for expanded/detail views.
 *
 * Aspect ratio: always 2:3 (standard movie poster).
 * Use aspect-ratio CSS property or padding-bottom hack for older browsers.
 */
function PosterPlaceholder({ title, size = "md" }) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  const dim = size === "sm" ? { w: 72, h: 108 } : { w: "100%", h: "100%" };
  return (
    <div style={{
      width: dim.w, height: dim.h,
      background: `linear-gradient(145deg, hsl(${h}, 30%, 85%) 0%, hsl(${(h+30)%360}, 25%, 75%) 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: theme.radiusSm, overflow: "hidden",
    }}>
      <span style={{
        fontSize: size === "sm" ? 28 : 48,
        fontWeight: 800, fontFamily: theme.font,
        color: `hsl(${h}, 20%, 55%)`, opacity: 0.4, userSelect: "none",
      }}>
        {title.charAt(0)}
      </span>
    </div>
  );
}

// ─── Rating ─────────────────────────────────────────────────────────────────
function RatingDisplay({ rating, size = "md" }) {
  if (rating == null) return null;
  const color = rating >= 8 ? theme.green : rating >= 7 ? theme.gold : rating >= 6 ? theme.textSecondary : theme.red;
  const bg = rating >= 8 ? theme.greenSoft : rating >= 7 ? theme.goldSoft : rating >= 6 ? theme.bgMuted : theme.redSoft;
  const fs = size === "sm" ? 12 : 14;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: fs, fontWeight: 700, fontFamily: theme.fontSans,
      color, background: bg, borderRadius: 6, padding: "2px 8px",
      fontVariantNumeric: "tabular-nums", lineHeight: 1.4,
    }}>
      <svg width={fs-2} height={fs-2} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01z"/>
      </svg>
      {rating.toFixed(1)}
    </span>
  );
}

// ─── Badges ─────────────────────────────────────────────────────────────────
/**
 * IMPLEMENTATION NOTE:
 * Badges communicate urgency and categorization at a glance.
 * They appear on the poster corner (absolute positioned).
 *
 * Priority order (only show the highest priority badge on poster):
 *   1. "Last chance" (red) — film leaves theaters within 48h
 *   2. "Limited" (purple) — 1-3 total screenings
 *   3. "New" (accent) — current year release
 *
 * The Curzon/MUBI pattern: scarcity badges drive urgency
 * and help users prioritize what to see first.
 */
function Badge({ label, color, bg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: 10, fontWeight: 700, fontFamily: theme.fontSans,
      textTransform: "uppercase", letterSpacing: "0.05em",
      color, background: bg, borderRadius: 4,
      padding: "3px 7px", lineHeight: 1,
    }}>
      {label}
    </span>
  );
}

function FilmBadge({ film }) {
  if (film.isLastChance) return <Badge label="Last chance" color={theme.red} bg={theme.redSoft} />;
  if (film.isLimitedRun) return <Badge label="Limited run" color={theme.purple} bg={theme.purpleSoft} />;
  if (film.isNewRelease) return <Badge label="New" color={theme.accent} bg={theme.accentSoft} />;
  return null;
}

// ─── Genre Chip ─────────────────────────────────────────────────────────────
function GenreChip({ label, isActive, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 13, fontWeight: isActive ? 700 : 500,
      fontFamily: theme.fontSans,
      color: isActive ? "#fff" : theme.textSecondary,
      background: isActive ? theme.accent : "transparent",
      border: isActive ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
      borderRadius: 20, padding: "6px 16px",
      cursor: "pointer", transition: "all 0.15s",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {label}
    </button>
  );
}

// ─── Film Card ──────────────────────────────────────────────────────────────
/**
 * IMPLEMENTATION NOTES:
 *
 * LAYOUT:
 * On mobile, each card is a horizontal row: poster (72px) + text.
 * This mirrors the Letterboxd mobile browse pattern.
 * On desktop grid, cards become vertical: poster on top, text below.
 * (This prototype shows the mobile layout only; adapt with CSS grid
 * or a useMediaQuery hook for desktop.)
 *
 * INTERACTION:
 * Tap card → expand to show synopsis + action buttons.
 * "See showtimes →" navigates to /showtimes#film-{slug}
 * or to a future /film/{slug} detail page.
 * IMDb link opens in new tab.
 *
 * ACCESSIBILITY:
 * - Card is a <button> or has role="button" + tabindex
 * - Expanded state uses aria-expanded
 * - IMDb link and "See showtimes" are separate focusable elements
 * - Poster img alt: "{title} ({year}) poster"
 */
function FilmCard({ film, isExpanded, onToggle }) {
  const badge = FilmBadge({ film });
  return (
    <div style={{
      background: theme.bgCard,
      borderRadius: theme.radius,
      border: `1px solid ${isExpanded ? theme.border : theme.borderLight}`,
      boxShadow: isExpanded ? theme.shadowHover : theme.shadow,
      overflow: "hidden",
      transition: "box-shadow 0.2s, border-color 0.2s",
      cursor: "pointer",
    }}>
      {/* Main row */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", gap: 14, padding: 14,
          alignItems: "flex-start",
        }}
      >
        {/* Poster with badge overlay */}
        <div style={{
          width: 72, minWidth: 72, height: 108,
          borderRadius: theme.radiusSm, overflow: "hidden",
          position: "relative", flexShrink: 0,
        }}>
          <PosterPlaceholder title={film.title} size="sm" />
          {badge && (
            <div style={{ position: "absolute", top: 4, left: 4 }}>
              {badge}
            </div>
          )}
        </div>

        {/* Text content */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{
              fontSize: 16, fontWeight: 700, fontFamily: theme.font,
              color: theme.text, margin: 0, lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {film.title}
            </h3>
            <RatingDisplay rating={film.rating} size="sm" />
          </div>

          {/* Meta line */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginTop: 3, fontSize: 13, fontFamily: theme.fontSans,
            color: theme.textMuted,
          }}>
            <span>{film.year}</span>
            <span style={{ fontSize: 4 }}>●</span>
            <span>{film.runtime}</span>
          </div>

          {/* Genre tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {film.genres.slice(0, 3).map(g => (
              <span key={g} style={{
                fontSize: 11, fontWeight: 500, fontFamily: theme.fontSans,
                color: theme.textSecondary, background: theme.bgMuted,
                borderRadius: 4, padding: "2px 7px",
              }}>
                {g}
              </span>
            ))}
            {film.genres.length > 3 && (
              <span style={{ fontSize: 11, color: theme.textMuted, padding: "2px 2px" }}>
                +{film.genres.length - 3}
              </span>
            )}
          </div>

          {/* Availability summary — the "at a glance" line */}
          <div style={{
            marginTop: "auto", paddingTop: 8,
            display: "flex", alignItems: "center", gap: 10,
            fontSize: 12, fontFamily: theme.fontSans, color: theme.textMuted,
          }}>
            <span>{film.theaterCount} theater{film.theaterCount !== 1 ? "s" : ""}</span>
            <span style={{ fontSize: 4 }}>●</span>
            <span>{film.screeningCount} screening{film.screeningCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <div style={{
          display: "flex", alignItems: "center", paddingTop: 4,
          color: theme.textMuted, fontSize: 14,
          transition: "transform 0.2s",
          transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </div>
      </div>

      {/* Expanded section */}
      {isExpanded && (
        <div style={{
          padding: "0 14px 16px",
          borderTop: `1px solid ${theme.borderLight}`,
        }}>
          {/* Synopsis */}
          <p style={{
            fontSize: 14, fontFamily: theme.font,
            color: theme.textSecondary, lineHeight: 1.65,
            margin: "14px 0 16px",
          }}>
            {film.description}
          </p>

          {/* Available days — visual calendar strip */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, fontFamily: theme.fontSans,
              textTransform: "uppercase", letterSpacing: "0.06em",
              color: theme.textMuted, marginBottom: 6,
            }}>
              Showing
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {film.availableDays.map(d => (
                <span key={d} style={{
                  fontSize: 12, fontWeight: 600, fontFamily: theme.fontSans,
                  color: d === "Today" ? theme.accent : theme.textSecondary,
                  background: d === "Today" ? theme.accentSoft : theme.bgMuted,
                  borderRadius: 6, padding: "4px 10px",
                }}>
                  {d}
                </span>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 8,
          }}>
            {/* IMDb link — Fandango pattern: small, secondary */}
            <a
              href={film.imdbUrl} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 12, fontWeight: 700, fontFamily: theme.fontSans,
                color: "#000", background: "#F5C518",
                borderRadius: 5, padding: "5px 10px",
                textDecoration: "none",
              }}
            >
              IMDb
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round">
                <path d="M7 17L17 7M17 7H7M17 7v10"/>
              </svg>
            </a>

            {/* Primary CTA — MUBI/Curzon pattern: clear, warm */}
            <button
              onClick={e => { e.stopPropagation(); /* navigate to showtimes */ }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 14, fontWeight: 700, fontFamily: theme.fontSans,
                color: "#fff", background: theme.accent,
                border: "none", borderRadius: theme.radiusSm,
                padding: "10px 18px", cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.accentHover}
              onMouseLeave={e => e.currentTarget.style.background = theme.accent}
            >
              See showtimes
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section Separator ──────────────────────────────────────────────────────
/**
 * IMPLEMENTATION NOTE:
 * Films are grouped into labeled sections (Letterboxd/Fandango pattern):
 *   - "Highlights" — editorially pinned or highest rated, limited to 3
 *   - "New this week" — isNewRelease, sorted by rating
 *   - "Don't miss" — isLimitedRun or isLastChance
 *   - "Still playing" — everything else
 *
 * On the initial load, show all sections. When a genre filter is active
 * or search is non-empty, collapse into a flat sorted list instead
 * (sections become noise when the user is actively filtering).
 */
function SectionHeader({ title, subtitle, count }) {
  return (
    <div style={{ marginBottom: 10, marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h2 style={{
          fontSize: 20, fontWeight: 700, fontFamily: theme.font,
          color: theme.text, margin: 0,
        }}>
          {title}
        </h2>
        {count != null && (
          <span style={{
            fontSize: 13, fontFamily: theme.fontSans,
            color: theme.textMuted, fontWeight: 500,
          }}>
            {count} film{count !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {subtitle && (
        <p style={{
          fontSize: 14, fontFamily: theme.fontSans,
          color: theme.textMuted, margin: "2px 0 0",
        }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────
export default function BCNCinemasRedesign() {
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [sortBy, setSortBy] = useState("rating");
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const allGenres = useMemo(() => getAllGenres(FILMS), []);

  const isFiltering = selectedGenre !== "All" || searchQuery.trim().length > 0;

  // Filter
  const filtered = useMemo(() => {
    let r = FILMS;
    if (selectedGenre !== "All") r = r.filter(f => f.genres.includes(selectedGenre));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter(f =>
        f.title.toLowerCase().includes(q) ||
        f.genres.some(g => g.toLowerCase().includes(q)) ||
        f.description.toLowerCase().includes(q)
      );
    }
    return r;
  }, [selectedGenre, searchQuery]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "rating": return arr.sort((a,b) => (b.rating??0) - (a.rating??0));
      case "title": return arr.sort((a,b) => a.title.localeCompare(b.title));
      case "screenings": return arr.sort((a,b) => b.screeningCount - a.screeningCount);
      default: return arr;
    }
  }, [filtered, sortBy]);

  // Sections (only when NOT filtering)
  const sections = useMemo(() => {
    if (isFiltering) return null;
    const highlights = FILMS.filter(f => f.rating >= 8.0).sort((a,b) => b.rating - a.rating).slice(0, 3);
    const highlightIds = new Set(highlights.map(f => f.id));
    const dontMiss = FILMS.filter(f => (f.isLimitedRun || f.isLastChance) && !highlightIds.has(f.id));
    const dontMissIds = new Set(dontMiss.map(f => f.id));
    const rest = FILMS.filter(f => !highlightIds.has(f.id) && !dontMissIds.has(f.id)).sort((a,b) => (b.rating??0) - (a.rating??0));
    return { highlights, dontMiss, rest };
  }, [isFiltering]);

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.bg,
      color: theme.text,
      fontFamily: theme.fontSans,
    }}>
      {/* Google Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Sticky Header ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(250,250,248,0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: `1px solid ${theme.border}`,
      }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px 8px",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{
              fontSize: 20, fontWeight: 700, fontFamily: theme.font,
              color: theme.accent,
            }}>
              BCN
            </span>
            <span style={{
              fontSize: 20, fontWeight: 700, fontFamily: theme.font,
              color: theme.text,
            }}>
              cinemas
            </span>
          </div>

          {/* Nav tabs — Discover vs Showtimes */}
          <div style={{ display: "flex", gap: 2 }}>
            <button style={{
              fontSize: 12, fontWeight: 700,
              padding: "5px 12px", borderRadius: 6,
              border: "none", cursor: "pointer",
              background: theme.accent, color: "#fff",
            }}>
              Discover
            </button>
            <button style={{
              fontSize: 12, fontWeight: 600,
              padding: "5px 12px", borderRadius: 6,
              border: `1px solid ${theme.border}`, cursor: "pointer",
              background: "transparent", color: theme.textSecondary,
            }}>
              Showtimes
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "0 16px 8px", position: "relative" }}>
          <svg
            width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke={theme.textMuted} strokeWidth="2" strokeLinecap="round"
            style={{ position: "absolute", left: 28, top: "50%", transform: "translateY(-50%)" }}
          >
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search films, genres, directors…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 12px 10px 38px",
              background: theme.bgMuted,
              border: `1px solid ${theme.borderLight}`,
              borderRadius: theme.radiusSm,
              color: theme.text,
              fontSize: 14, fontFamily: theme.fontSans,
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute", right: 24, top: "50%",
                transform: "translateY(-50%)",
                background: theme.border, border: "none",
                borderRadius: "50%", width: 20, height: 20,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: theme.textSecondary, fontSize: 12,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Genre filter pills */}
        <div style={{
          display: "flex", gap: 6,
          overflowX: "auto", WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          padding: "0 16px 10px",
        }}>
          <GenreChip label="All" isActive={selectedGenre === "All"} onClick={() => setSelectedGenre("All")} />
          {allGenres.map(g => (
            <GenreChip
              key={g} label={g}
              isActive={selectedGenre === g}
              onClick={() => setSelectedGenre(selectedGenre === g ? "All" : g)}
            />
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{
        maxWidth: 640, margin: "0 auto",
        padding: "4px 12px 80px",
      }}>
        {/* Sort bar (when filtering) */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 4px 4px",
        }}>
          <span style={{
            fontSize: 13, fontFamily: theme.fontSans,
            color: theme.textMuted, fontWeight: 500,
          }}>
            {isFiltering
              ? `${sorted.length} film${sorted.length !== 1 ? "s" : ""}`
              : `${FILMS.length} films showing in Barcelona`
            }
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: theme.textMuted }}>
            <span>Sort:</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                background: theme.bgMuted, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 6,
                padding: "4px 8px", fontSize: 12,
                fontFamily: theme.fontSans,
                cursor: "pointer", outline: "none",
              }}
            >
              <option value="rating">Rating</option>
              <option value="title">Title A–Z</option>
              <option value="screenings">Most screenings</option>
            </select>
          </div>
        </div>

        {/* Empty state */}
        {sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 16px", color: theme.textMuted }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <p style={{ fontSize: 15, fontWeight: 500, fontFamily: theme.font }}>No films match your filters</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>Try a different genre or search term</p>
          </div>
        )}

        {/* ── Sectioned view (default, no filters) ── */}
        {!isFiltering && sections && (
          <>
            {/* Highlights */}
            {sections.highlights.length > 0 && (
              <>
                <SectionHeader title="Highlights" subtitle="Highest rated this week" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sections.highlights.map(f => (
                    <FilmCard key={f.id} film={f} isExpanded={expandedId === f.id}
                      onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)} />
                  ))}
                </div>
              </>
            )}

            {/* Don't miss */}
            {sections.dontMiss.length > 0 && (
              <>
                <SectionHeader
                  title="Don't miss"
                  subtitle="Limited screenings — book before they're gone"
                  count={sections.dontMiss.length}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sections.dontMiss.map(f => (
                    <FilmCard key={f.id} film={f} isExpanded={expandedId === f.id}
                      onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)} />
                  ))}
                </div>
              </>
            )}

            {/* Still playing */}
            {sections.rest.length > 0 && (
              <>
                <SectionHeader title="Now playing" count={sections.rest.length} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sections.rest.map(f => (
                    <FilmCard key={f.id} film={f} isExpanded={expandedId === f.id}
                      onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Flat list (when filtering/searching) ── */}
        {isFiltering && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {sorted.map(f => (
              <FilmCard key={f.id} film={f} isExpanded={expandedId === f.id}
                onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        borderTop: `1px solid ${theme.border}`,
        padding: "16px",
        textAlign: "center",
        fontSize: 12, fontFamily: theme.fontSans,
        color: theme.textMuted,
      }}>
        <p style={{ margin: "0 0 4px" }}>
          Listings updated every 30 minutes. Poster images and metadata from TMDb.
        </p>
        <p style={{ margin: 0, fontSize: 11 }}>
          BCNcinemas is not affiliated with any cinema chain.
        </p>
      </div>

      <style>{`
        input::placeholder { color: ${theme.textMuted}; }
        ::-webkit-scrollbar { display: none; }
        select:focus { border-color: ${theme.accent}; }
        @media (min-width: 640px) {
          /* Tablet: 2-column grid — apply to film card containers */
        }
        @media (min-width: 1024px) {
          /* Desktop: 3-column grid + sidebar filters */
        }
      `}</style>
    </div>
  );
}
