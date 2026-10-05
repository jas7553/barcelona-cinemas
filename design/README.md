# Design — UI rewrite

- `requirements.md` — what the site must do, page by page, plus non-functional budgets and open questions.
- `guidelines.md` — tokens, layout grid, components, maps, motion and copy.
- `prototype/` — a single-file throwaway prototype on fixture data. It's the visual reference, not code to port.

Run the prototype with `python3 -m http.server 8767 -d design/prototype`, then open http://localhost:8767/.

Prototype URL parameters:

| Parameter | Effect |
|---|---|
| `?day=YYYY-MM-DD` | Day view |
| `?page=film&film=<id>` | Film page |
| `?page=cinema&cinema=<id>` | Cinema page |
| `?page=cinemas` | Cinemas index |
| `?sheet=book` / `nobook` / `imax` | Open the ticket sheet (on any page) |
| `?page=film&over` | Film with no showings left |
| `?sheet=home` (`&geo=denied`) | Home sheet, optionally with location refused |
| `?page=privacy`, `?page=404` | Privacy page, Not-found page |
| `?loc=off` | No home set |
| `?stale` | Stale-data notice |
| `?missing` | Masters of the Universe with no poster, backdrop or runtime |
| `?reset` | Reset seen films and favourites to the demo seed |

The prototype's clock is fixed at Sun 4 Oct 17:30, and home is in Gràcia. The fixture has no booking links or subtitle data, so the prototype fakes them: six cinemas are bookable, History Lessons has English subs, Resisting Paradise has Spanish subs, and three films are IMAX at Diagonal Mar, Maquinista and Filmax after 19:00. Screenshots of each state are in `prototype/shots/final/`.

Figma: https://www.figma.com/design/QEr1BjCZE2k3wgh2UDErrC

- **"Final reference — 2026-10-04"** (node `29:3`) has all 25 screens from `prototype/shots/final/` (18 phone, 7 desktop) plus the colour and type tokens.
- **"Explorations (earlier rounds)"** holds the rejected directions.

The screens are screenshots, not editable layers. Re-shoot them when the prototype changes.
