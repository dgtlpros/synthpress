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

  describe("link wiring", () => {
    it.each([
      ["Features", "/#features"],
      ["Pricing", "/pricing"],
      ["How It Works", "/#how-it-works"],
      ["About", "/about"],
      ["Blog", "/blog"],
      ["Contact", "/contact"],
      ["Privacy Policy", "/privacy"],
      ["Terms of Service", "/terms"],
    ])("links %s to %s", (label, href) => {
      render(<Footer />);
      expect(screen.getByText(label).closest("a")).toHaveAttribute(
        "href",
        href,
      );
    });
  });
});
