import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SynopsisBlock } from "./SynopsisBlock";

const SHORT = "A short synopsis.";
const LONG = "A".repeat(161);

describe("SynopsisBlock", () => {
  it("renders short text without a toggle", () => {
    render(<SynopsisBlock text={SHORT} />);
    expect(screen.getByText(SHORT)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("truncates long text and shows 'Show more' button", () => {
    render(<SynopsisBlock text={LONG} />);
    expect(screen.getByRole("button")).toHaveTextContent("Show more");
    expect(screen.queryByText(LONG)).not.toBeInTheDocument();
  });

  it("expands on 'Show more' click", async () => {
    render(<SynopsisBlock text={LONG} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(LONG)).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Show less");
  });

  it("collapses on 'Show less' click", async () => {
    render(<SynopsisBlock text={LONG} />);
    await userEvent.click(screen.getByRole("button")); // expand
    await userEvent.click(screen.getByRole("button")); // collapse
    expect(screen.queryByText(LONG)).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Show more");
  });
});
