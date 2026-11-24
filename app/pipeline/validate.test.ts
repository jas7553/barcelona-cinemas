import { describe, expect, it } from "vitest";
import { recordingLogger } from "./providers/testFetcher.ts";
import { validateFilms } from "./validate.ts";

const START = "2026-03-28T18:00+01:00";

const showing = (extra: Record<string, unknown> = {}) => ({
  cinema: "Verdi",
  starts_at: START,
  language: "vo",
  ...extra,
});

function validate(films: unknown[]) {
  const { log, events } = recordingLogger();
  return { films: validateFilms(films, "verdi", log), events };
}

const onlyShowing = (extra: Record<string, unknown>) =>
  validate([{ title: "Dune: Part Two", showings: [showing(extra)] }]).films[0]?.showings[0];

describe("validateFilms: films", () => {
  it("keeps a valid imdb id, trimmed", () => {
    const { films } = validate([
      { title: "Dune: Part Two", imdb_id: "  tt15239678  ", showings: [] },
    ]);
    expect(films).toEqual([{ title: "Dune: Part Two", imdb_id: "tt15239678", showings: [] }]);
  });

  it.each([["imdb-15239678"], [15239678]])("drops the imdb id %j and keeps the film", (imdb_id) => {
    const { films } = validate([{ title: "Dune: Part Two", imdb_id, showings: [] }]);
    expect(films).toEqual([{ title: "Dune: Part Two", showings: [] }]);
  });

  it("keeps a positive year and drops any other", () => {
    const { films } = validate([
      { title: "A", year: 2024, showings: [] },
      { title: "B", year: 0, showings: [] },
      { title: "C", year: "2024", showings: [] },
    ]);
    expect(films).toEqual([
      { title: "A", year: 2024, showings: [] },
      { title: "B", showings: [] },
      { title: "C", showings: [] },
    ]);
  });

  it("drops a film without a title or a showings list, and keeps one left without showings", () => {
    const { films } = validate([
      { title: "  ", showings: [] },
      { title: "No list" },
      "not a film",
      { title: " Aftersun ", showings: [{ cinema: "Verdi" }] },
    ]);
    expect(films).toEqual([{ title: "Aftersun", showings: [] }]);
  });
});

describe("validateFilms: showings", () => {
  it("keeps the language", () => {
    expect(onlyShowing({})).toEqual(showing());
  });

  it("keeps valid audio and subtitle languages", () => {
    expect(onlyShowing({ audio_lang: "other", subtitle_lang: "es" })).toEqual(
      showing({ audio_lang: "other", subtitle_lang: "es" }),
    );
  });

  it("drops invalid audio and subtitle languages", () => {
    expect(onlyShowing({ audio_lang: "klingon", subtitle_lang: "fr" })).toEqual(showing());
  });

  it("keeps a valid premium format and drops an unknown one", () => {
    expect(onlyShowing({ premium_format: "imax" })).toEqual(showing({ premium_format: "imax" }));
    expect(onlyShowing({ premium_format: "4dx" })).toEqual(showing());
  });

  it("keeps a valid booking URL", () => {
    const booking_url = "https://tickets.example/?perfCode=1";
    expect(onlyShowing({ booking_url })).toEqual(showing({ booking_url }));
  });

  it.each([["javascript:alert(1)"], ["null"], [42]])("drops the booking URL %j", (booking_url) => {
    expect(onlyShowing({ booking_url })).toEqual(showing());
  });

  it("drops a booking URL with an unfilled placeholder, and says so", () => {
    const { films, events } = validate([
      {
        title: "Digger",
        showings: [
          showing({ booking_url: "https://tickets.example/?perfCode=1&language=%s&theatre=%s" }),
        ],
      },
    ]);
    expect(films[0]?.showings).toEqual([showing()]);
    expect(events).toEqual([
      {
        event: "provider_output_discarded",
        fields: { provider: "verdi", discarded: { "booking_url: unfilled %s placeholder": 1 } },
      },
    ]);
  });

  it("treats blank and null fields as unset, without a warning", () => {
    const { films, events } = validate([
      { title: "A", imdb_id: " ", showings: [showing({ booking_url: "  ", audio_lang: null })] },
    ]);
    expect(films).toEqual([{ title: "A", showings: [showing()] }]);
    expect(events).toEqual([]);
  });

  it("drops a showing without a cinema or a valid start", () => {
    const { films } = validate([
      {
        title: "A",
        showings: [
          showing({ cinema: " " }),
          showing({ starts_at: "2026-02-30T18:00+01:00" }),
          showing({ starts_at: "2026-03-28T24:00+01:00" }),
          showing({ starts_at: "2026-03-28 18:00" }),
          showing(),
        ],
      },
    ]);
    expect(films[0]?.showings).toEqual([showing()]);
  });

  it("keeps a showing's source labels", () => {
    const labels = { version: "original_st", audio: "ENGLISH" };
    expect(onlyShowing({ labels })).toEqual(showing({ labels }));
  });
});
