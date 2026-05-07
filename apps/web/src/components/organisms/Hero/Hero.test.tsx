import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Hero } from "./Hero";

afterEach(cleanup);

describe("Hero", () => {
  it("renders headline", () => {
    render(<Hero />);
    expect(screen.getByText(/AI-Powered Blog Publishing/)).toBeInTheDocument();
  });

  it("renders subtitle", () => {
    render(<Hero />);
    expect(
      screen.getByText(/Generate, publish, and syndicate/),
    ).toBeInTheDocument();
  });

  it("renders CTA buttons with correct hrefs", () => {
    render(<Hero />);
    expect(screen.getByText("Get Started")).toHaveAttribute("href", "/signup");
    expect(screen.getByText("See How It Works")).toHaveAttribute(
      "href",
      "#how-it-works",
    );
  });

  it("renders logo", () => {
    render(<Hero />);
    expect(screen.getByAltText("SynthPress mascot")).toBeInTheDocument();
  });

  it("renders the public beta indicator pill", () => {
    render(<Hero />);
    expect(screen.getByText("Now in Public Beta")).toBeInTheDocument();
  });
});
