import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Navbar } from "./Navbar";

afterEach(cleanup);

describe("Navbar", () => {
  it("renders logo", () => {
    render(<Navbar />);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });

  it("renders nav links", () => {
    render(<Navbar />);
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("How It Works")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
  });

  it("renders CTA button linking to pricing", () => {
    render(<Navbar />);
    const cta = screen.getByText("Get Started");
    expect(cta).toHaveAttribute("href", "#pricing");
  });
});
