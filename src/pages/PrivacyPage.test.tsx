import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage from "./PrivacyPage";

describe("PrivacyPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the main heading", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "Privacy", level: 1 })).toBeInTheDocument();
  });

  it("renders all major section headings", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: /what this site does not do/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /stored only in your browser/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /location/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /other sites your browser contacts/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /hosting and search/i })).toBeInTheDocument();
  });

  it("accurately claims no cookies", () => {
    render(<PrivacyPage />);
    // The first list item starts with "No cookies" — test for the list item text
    expect(screen.getAllByText(/no cookies/i).length).toBeGreaterThan(0);
  });

  it("accurately claims no analytics", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/no analytics/i)).toBeInTheDocument();
  });

  it("accurately claims no user accounts", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/no user accounts/i)).toBeInTheDocument();
  });

  it("documents the three browser-storage keys", () => {
    render(<PrivacyPage />);
    // Each key appears as <code> elements; getAllByText handles multiple occurrences
    expect(screen.getAllByText("btw-dark").length).toBeGreaterThan(0);
    expect(screen.getAllByText("location_active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("btw-warmed").length).toBeGreaterThan(0);
  });

  it("states coordinates are never sent anywhere", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/never sent to any server/i)).toBeInTheDocument();
  });

  it("mentions TMDb image hosting", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/image\.tmdb\.org/)).toBeInTheDocument();
  });

  it("mentions CloudFront access logging is disabled", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/access logging is disabled/i)).toBeInTheDocument();
  });

  it("has a back-link to the home page", () => {
    render(<PrivacyPage />);
    const backLink = screen.getByRole("link", { name: /back to barcelona this week/i });
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("has a footer link to /privacy", () => {
    render(<PrivacyPage />);
    const privacyLinks = screen.getAllByRole("link", { name: /privacy/i });
    const footerLink = privacyLinks.find((el) => el.getAttribute("href") === "/privacy");
    expect(footerLink).toBeDefined();
  });

  it("includes a theme toggle button", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("button", { name: /toggle dark mode/i })).toBeInTheDocument();
  });

  it("shows the effective date", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/effective:/i)).toBeInTheDocument();
  });
});
