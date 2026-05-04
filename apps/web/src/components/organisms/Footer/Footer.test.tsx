import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Footer } from "./Footer";

afterEach(cleanup);

describe("Footer", () => {
  it("renders logo", () => {
    render(<Footer />);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });

  it("renders link categories", () => {
    render(<Footer />);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("renders copyright", () => {
    render(<Footer />);
    expect(screen.getByText(/2026 SynthPress/)).toBeInTheDocument();
  });

  it("renders product links", () => {
    render(<Footer />);
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
  });
});
