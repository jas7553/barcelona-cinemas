import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipNav } from "./ChipNav";
import type { CinemaRegistry } from "../types";

const CINEMAS: CinemaRegistry = {
  Verdi:  { address: "", neighborhood: "Gràcia" },
  Malda:  { address: "", neighborhood: "Gothic Quarter" },
  Glòries:{ address: "", neighborhood: "Poble-Nou" },
};

describe("ChipNav", () => {
  beforeEach(() => localStorage.clear());

  it("renders All chip and one chip per unique neighborhood", () => {
    render(<ChipNav cinemas={CINEMAS} active="All" onSelect={() => {}} />);
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Gothic Quarter")).toBeInTheDocument();
    expect(screen.getByText("Gràcia")).toBeInTheDocument();
    expect(screen.getByText("Poble-Nou")).toBeInTheDocument();
  });

  it("marks the active chip", () => {
    render(<ChipNav cinemas={CINEMAS} active="Gràcia" onSelect={() => {}} />);
    expect(screen.getByText("Gràcia").closest("button")).toHaveClass("active");
    expect(screen.getByText("All").closest("button")).not.toHaveClass("active");
  });

  it("calls onSelect when a chip is clicked", async () => {
    const onSelect = vi.fn();
    render(<ChipNav cinemas={CINEMAS} active="All" onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Gràcia"));
    expect(onSelect).toHaveBeenCalledWith("Gràcia");
  });
});
