import { describe, expect, it } from "vitest";
import { bookingHref, siteOnly } from "./ticket";

const theater = { website_url: "https://verdi.example" };

describe("bookingHref", () => {
  it("is the showing's own booking page when it has one", () => {
    expect(bookingHref({ booking_url: "https://verdi.example/b/1" }, theater)).toBe("https://verdi.example/b/1");
    expect(siteOnly({ booking_url: "https://verdi.example/b/1" })).toBe(false);
  });

  it("falls back to the cinema's site when it has none", () => {
    for (const booking_url of [undefined, null, ""]) {
      expect(bookingHref({ booking_url }, theater)).toBe("https://verdi.example");
      expect(siteOnly({ booking_url })).toBe(true);
    }
  });
});
