import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import Header from "./Header";

const defaultPin = { active: false, error: false, onToggle: vi.fn() };
const defaultLastChance = { active: false, onToggle: vi.fn() };

describe("Header", () => {
  it("renders search input", () => {
    render(<Header searchQuery="" onSearch={vi.fn()} locationPin={defaultPin} lastChance={defaultLastChance} />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("renders inactive pin button by default", () => {
    render(<Header searchQuery="" onSearch={vi.fn()} locationPin={defaultPin} lastChance={defaultLastChance} />);
    expect(screen.getByRole("button", { name: /enable distance sorting/i })).toBeInTheDocument();
  });

  it("renders active aria-label when active=true", () => {
    render(
      <Header
        searchQuery=""
        onSearch={vi.fn()}
        locationPin={{ ...defaultPin, active: true }}
        lastChance={defaultLastChance}
      />,
    );
    expect(screen.getByRole("button", { name: /disable distance sorting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable distance sorting/i })).toHaveClass("is-active");
  });

  it("calls onToggle when pin button is clicked", async () => {
    const onToggle = vi.fn();
    render(
      <Header
        searchQuery=""
        onSearch={vi.fn()}
        locationPin={{ ...defaultPin, onToggle }}
        lastChance={defaultLastChance}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /enable distance sorting/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows error message and hides pin button when error=true", () => {
    render(
      <Header
        searchQuery=""
        onSearch={vi.fn()}
        locationPin={{ ...defaultPin, error: true }}
        lastChance={defaultLastChance}
      />,
    );
    expect(screen.getByText(/location unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /distance sorting/i })).not.toBeInTheDocument();
  });
});
