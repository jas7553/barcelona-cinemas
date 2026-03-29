import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DateBar from "./DateBar";

describe("DateBar", () => {
  it("renders a named day filter group with pressed buttons instead of tabs", () => {
    render(<DateBar selectedDate={0} onSelect={vi.fn()} />);

    expect(screen.getByRole("group", { name: "Filter by day" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    const todayButton = screen.getByRole("button", { name: /Today/i });
    expect(todayButton).toHaveAttribute("aria-pressed", "true");
    expect(todayButton).not.toHaveAttribute("role", "tab");
  });
});
