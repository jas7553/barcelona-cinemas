import { fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { PREF_KEYS } from "../domain/prefs";
import { PrivacyPage } from "./PrivacyPage";

const data = { renderedAt: "2026-10-04T10:19:00Z", generatedAt: "2026-10-04T08:19:00Z", theaters: [] };

afterEach(() => localStorage.clear());

describe("PrivacyPage", () => {
  it("forgets everything stored on the device, and says so", () => {
    localStorage.setItem(PREF_KEYS.home, '{"lat":41.4,"lng":2.15}');
    localStorage.setItem(PREF_KEYS.seen, '["1"]');
    render(<PrivacyPage data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Forget all of it" }));
    expect(localStorage.length).toBe(0);
    expect(screen.getByText("Done. Nothing is stored on this device now.")).toBeInTheDocument();
  });

  it("opens the Home sheet from the header", () => {
    render(<PrivacyPage data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /home/i }));
    expect(screen.getByRole("dialog", { name: "Home" })).toBeInTheDocument();
  });
});
