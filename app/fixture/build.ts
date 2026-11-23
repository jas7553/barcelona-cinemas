import type { Cinema, Film, Listings, Showing } from "../shared/listings.ts";
import { addDays, cinemaDay, madridIso } from "../shared/madrid.ts";

const MINUTE = 60_000;

type CinemaKey =
  "balmes" | "diagonal-mar" | "maquinista" | "verdi" | "renoir-floridablanca" | "phenomena";

/** Showings of one film at one cinema: every `time` on every day offset from today. */
interface Run {
  cinema: CinemaKey;
  days: readonly number[];
  times: readonly string[];
  version?: Showing["version"];
  audio?: Showing["audio"];
  booking?: boolean;
}

type FilmSpec = Omit<Film, "showings"> & { runs: readonly Run[] };

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d += step) out.push(d);
  return out;
}

const EVERY_DAY = range(0, 20);

function cinemas(today: string, checkedAt: string): Cinema[] {
  const through = (days: number) => ({
    published_through: addDays(today, days),
    checked_at: checkedAt,
  });
  return [
    {
      id: "balmes",
      name: "Mooby Balmes",
      short_name: "Balmes",
      chain: "Mooby",
      code: "Ba",
      neighborhood: "Sant Gervasi",
      description: "Multiplex",
      lat: 41.4072,
      lng: 2.1386,
      place_id: "ChIJfixtureMoobyBalmes00001",
      website_url: "https://www.moobycinemas.com/balmes?setLang=en",
      coverage: "full",
      ...through(20),
    },
    {
      id: "diagonal-mar",
      name: "Cinesa Diagonal Mar",
      short_name: "Diagonal Mar",
      chain: "Cinesa",
      code: "DM",
      neighborhood: "Diagonal Mar",
      description: "Mall multiplex",
      lat: 41.4102,
      lng: 2.2166,
      place_id: "ChIJfixtureCinesaDiagMar0001",
      website_url: "https://www.cinesa.es/cines/diagonal-mar/",
      coverage: "full",
      ...through(20),
    },
    {
      id: "maquinista",
      name: "Yelmo La Maquinista",
      short_name: "La Maquinista",
      chain: "Yelmo",
      code: "Mq",
      neighborhood: "Sant Andreu",
      description: "Mall multiplex",
      lat: 41.4408,
      lng: 2.1983,
      place_id: "ChIJfixtureYelmoMaquinista01",
      website_url: "https://www.yelmocines.es/en/cartelera/barcelona/westfield-la-maquinista",
      coverage: "english_only",
      ...through(8),
    },
    {
      id: "verdi",
      name: "Cines Verdi",
      short_name: "Verdi",
      chain: "Verdi",
      code: "Ve",
      neighborhood: "Gràcia",
      description: "Arthouse, original version since 1987",
      lat: 41.404,
      lng: 2.1569,
      place_id: "ChIJfixtureCinesVerdi0000001",
      website_url: "https://barcelona.cines-verdi.com",
      coverage: "full",
      ...through(20),
    },
    {
      id: "renoir-floridablanca",
      name: "Renoir Floridablanca",
      short_name: "Floridablanca",
      chain: "Renoir",
      code: "Fb",
      neighborhood: "Sant Antoni",
      description: "Arthouse",
      lat: 41.3819,
      lng: 2.1623,
      place_id: "ChIJfixtureRenoirFlorida0001",
      website_url: "https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/",
      coverage: "full",
      ...through(20),
    },
    {
      id: "phenomena",
      name: "Phenomena",
      short_name: "Phenomena",
      chain: "Independent",
      code: "Ph",
      neighborhood: "Sagrada Família",
      description: "Cult films and classics on one big screen",
      lat: 41.4091,
      lng: 2.1718,
      place_id: "ChIJfixturePhenomena00000001",
      website_url: "https://phenomena-experience.com",
      coverage: "full",
      ...through(13),
    },
  ];
}

function films(year: number): FilmSpec[] {
  return [
    {
      id: "900001",
      title: "The Lighthouse Keeper's Daughter",
      tmdb_id: 900001,
      imdb_id: "tt9000001",
      year,
      runtime_minutes: 112,
      genres: ["Drama", "Romance"],
      rating: { average: 7.4, votes: 1830 },
      popularity: 84.2,
      tagline: "Every light needs a keeper.",
      directors: ["Morag Lennox"],
      cast: ["Isla Fraser", "Tom Achterberg", "Nell Okafor"],
      synopsis:
        "On a storm-bound island off the Scottish coast, a keeper's daughter takes over the light the winter her father falls ill.",
      poster_path: "/fixtureLighthouseKeeper.jpg",
      trailer_youtube_key: "fxLighthse1",
      runs: [
        { cinema: "balmes", days: EVERY_DAY, times: ["17:00", "21:00"], booking: true },
        { cinema: "verdi", days: EVERY_DAY, times: ["16:59", "20:59"] },
        { cinema: "maquinista", days: range(0, 8), times: ["19:30"] },
        { cinema: "diagonal-mar", days: EVERY_DAY, times: ["18:15"], version: "dubbed" },
      ],
    },
    {
      id: "900002",
      title: "El carrer de les acàcies",
      tmdb_id: 900002,
      imdb_id: "tt9000002",
      year: year - 1,
      runtime_minutes: 98,
      genres: ["Drama"],
      rating: { average: 6.9, votes: 212 },
      popularity: 12.5,
      tagline: "Tres generacions, un replà.",
      directors: ["Laia Puigdomènech"],
      cast: ["Montse Ferrer", "Jordi Bassols"],
      synopsis: "Three generations share one landing in Gràcia over the summer of the festa major.",
      poster_path: "/fixtureCarrerAcacies.jpg",
      runs: [
        { cinema: "verdi", days: EVERY_DAY, times: ["18:00"], audio: "other" },
        { cinema: "renoir-floridablanca", days: EVERY_DAY, times: ["20:30"], audio: "other" },
      ],
    },
    {
      id: "900003",
      title: "Midnight at the Paradiso",
      tmdb_id: 900003,
      year: 1987,
      runtime_minutes: 91,
      genres: ["Horror", "Comedy"],
      rating: { average: 6.1, votes: 48 },
      popularity: 3.1,
      directors: ["Vic Delgado"],
      poster_path: "/fixtureMidnightParadiso.jpg",
      runs: [
        { cinema: "phenomena", days: range(0, 13, 2), times: ["22:00"], audio: "unknown" },
        { cinema: "phenomena", days: range(1, 13, 4), times: ["00:30"], audio: "unknown" },
      ],
    },
    {
      id: "mirall-trencat",
      title: "Mirall trencat",
      runs: [
        { cinema: "renoir-floridablanca", days: range(1, 6), times: ["19:00"], audio: "other" },
      ],
    },
    {
      id: "900005",
      title:
        "The Extraordinarily Long and Winding Account of How Everyone in the Village Came to Agree on Absolutely Nothing at All",
      tmdb_id: 900005,
      imdb_id: "tt9000005",
      year,
      runtime_minutes: 154,
      genres: ["Comedy"],
      rating: { average: 7.9, votes: 5400 },
      popularity: 151.7,
      tagline: "Nobody agrees. Everybody's right.",
      directors: ["Hamish Wren"],
      cast: ["Priya Nandakumar", "Owen Stiles", "Bea Holloway", "Ramón Ibarra", "Kit Marsh"],
      synopsis:
        "A parish council meeting about a bench runs, with interruptions, for three hundred years.",
      poster_path: "/fixtureLongWindingVillage.jpg",
      trailer_youtube_key: "fxLongWind2",
      runs: [
        { cinema: "balmes", days: EVERY_DAY, times: ["19:45"], booking: true },
        { cinema: "diagonal-mar", days: EVERY_DAY, times: ["19:45"], version: "dubbed" },
      ],
    },
    {
      id: "900006",
      title: "The Cartographer",
      tmdb_id: 900006,
      imdb_id: "tt9000006",
      year,
      runtime_minutes: 127,
      genres: ["Adventure", "Drama"],
      rating: { average: 7.1, votes: 96 },
      popularity: 40.3,
      tagline: "Some places are only on the map.",
      directors: ["Anouk Verhaegen"],
      cast: ["Sam Adeyemi", "Clara Lindqvist"],
      synopsis: "A mapmaker is sent to chart an island that the sea charts keep losing.",
      poster_path: "/fixtureCartographer.jpg",
      trailer_youtube_key: "fxCartogr3_",
      runs: [
        { cinema: "balmes", days: range(3, 20), times: ["20:00"], booking: true },
        { cinema: "verdi", days: range(3, 20), times: ["21:00"] },
      ],
    },
    {
      id: "900007",
      title: "Last Orders at the Kingfisher",
      tmdb_id: 900007,
      imdb_id: "tt9000007",
      year: year - 1,
      runtime_minutes: 104,
      genres: ["Comedy", "Drama"],
      rating: { average: 7.7, votes: 2210 },
      popularity: 18.9,
      tagline: "Time, gentlemen.",
      directors: ["Declan Moyes"],
      cast: ["Frank Doolan", "Maeve Corr"],
      synopsis: "The regulars of a Dublin pub get one last night before it closes for good.",
      poster_path: "/fixtureLastOrders.jpg",
      runs: [
        { cinema: "verdi", days: [0, 1], times: ["16:00", "21:15"] },
        { cinema: "renoir-floridablanca", days: [0, 1], times: ["17:30"] },
      ],
    },
    {
      id: "900008",
      previous_ids: ["paper-moons"],
      title: "Paper Moons",
      tmdb_id: 900008,
      imdb_id: "tt9000008",
      year,
      runtime_minutes: 88,
      genres: ["Animation", "Family"],
      rating: { average: 8.2, votes: 640 },
      popularity: 66.0,
      directors: ["Yuki Hara", "Ines Castell"],
      cast: ["Aiko Tamura", "Leo Brandt"],
      synopsis: "Two kids build a moon out of newspaper and have to keep it from getting wet.",
      poster_path: "/fixturePaperMoons.jpg",
      runs: [
        { cinema: "maquinista", days: range(0, 8), times: ["17:15"] },
        { cinema: "diagonal-mar", days: EVERY_DAY, times: ["16:30"], version: "dubbed" },
      ],
    },
    {
      id: "900009",
      title: "The Winter Ferry",
      tmdb_id: 900009,
      imdb_id: "tt9000009",
      year: year - 1,
      runtime_minutes: 101,
      genres: ["Drama"],
      directors: ["Signe Halvorsen"],
      synopsis: "The last ferry of the season leaves one passenger behind on purpose.",
      poster_path: "/fixtureWinterFerry.jpg",
      runs: [],
    },
  ];
}

function showings(today: string, filmId: string, runs: readonly Run[]): Showing[] {
  return runs.flatMap((run) =>
    run.days.flatMap((offset) =>
      run.times.map((time): Showing => {
        const day = addDays(today, offset);
        const date = time < "06:00" ? addDays(day, 1) : day;
        const version = run.version ?? "original";
        const showing: Showing = {
          cinema_id: run.cinema,
          starts_at: madridIso(date, time),
          version,
          audio: run.audio ?? (version === "dubbed" ? "other" : "en"),
        };
        if (run.booking === true) {
          showing.booking_url = `https://www.moobycinemas.com/${run.cinema}/book/${filmId}/${date}/${time.replace(":", "")}`;
        }
        return showing;
      }),
    ),
  );
}

/**
 * A hand-built, valid `v2` document whose showings start on the cinema day of `now` and run for
 * 21 days. The same `now` gives the same document.
 */
export function buildFixture(now: Date): Listings {
  const today = cinemaDay(now);
  const generatedAt = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE - 60 * MINUTE);
  const checkedAt = new Date(generatedAt.getTime() - 5 * MINUTE).toISOString();
  return {
    schema_version: 2,
    generated_at: generatedAt.toISOString(),
    cinemas: cinemas(today, checkedAt),
    films: films(Number(today.slice(0, 4))).map(({ runs, ...film }) => ({
      ...film,
      showings: showings(today, film.id, runs),
    })),
  };
}
