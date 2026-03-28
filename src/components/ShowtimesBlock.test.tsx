import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShowtimesBlock } from "./ShowtimesBlock";
import type { Showtime } from "../types";

function makeShowtime(date: string, time: string): Showtime {
  return { date, time, cinema: "Verdi", neighborhood: "Gràcia", address: "" };
}

const FEW: Showtime[] = [
  makeShowtime("2026-03-28", "18:00"),
  makeShowtime("2026-03-29", "18:00"),
];

// 4 different dates → exceeds SHOW_LIMIT of 3
const MANY: Showtime[] = [
  makeShowtime("2026-03-28", "18:00"),
  makeShowtime("2026-03-29", "18:00"),
  makeShowtime("2026-03-30", "18:00"),
  makeShowtime("2026-03-31", "18:00"),
];

describe("ShowtimesBlock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T00:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders all rows when within limit", () => {
    render(<ShowtimesBlock showtimes={FEW} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("shows '+N more' button when over limit", () => {
    render(<ShowtimesBlock showtimes={MANY} />);
    expect(screen.getByRole("button")).toHaveTextContent("+1 more");
  });

  // fireEvent used here to avoid userEvent/fake-timer interaction
  it("expands all rows on click", () => {
    render(<ShowtimesBlock showtimes={MANY} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("Show less");
    expect(screen.getByText(/Tue/)).toBeInTheDocument();
  });

  it("collapses back on second click", () => {
    render(<ShowtimesBlock showtimes={MANY} />);
    fireEvent.click(screen.getByRole("button")); // expand
    fireEvent.click(screen.getByRole("button")); // collapse
    expect(screen.getByRole("button")).toHaveTextContent("+1 more");
    expect(screen.queryByText(/Tue/)).not.toBeInTheDocument();
  });
});
