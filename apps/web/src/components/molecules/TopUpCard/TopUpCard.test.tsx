import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { TopUpCard } from "./TopUpCard";

afterEach(cleanup);

const baseProps = {
  name: "2,000 synth tokens",
  description: "Best value for the average month",
  tokens: 2000,
  priceCents: 5900,
  cta: <button>Buy now</button>,
};

describe("TopUpCard", () => {
  it("renders name, description, tokens, and price", () => {
    render(<TopUpCard {...baseProps} />);
    expect(screen.getByText("2,000 synth tokens")).toBeInTheDocument();
    expect(
      screen.getByText("Best value for the average month"),
    ).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.getByText("$59")).toBeInTheDocument();
  });

  it("renders the CTA", () => {
    render(<TopUpCard {...baseProps} />);
    expect(screen.getByRole("button", { name: "Buy now" })).toBeInTheDocument();
  });

  it("supports highlighted variant", () => {
    render(<TopUpCard {...baseProps} highlighted />);
    expect(screen.getByText("2,000 synth tokens")).toBeInTheDocument();
  });

  it("renders without a description", () => {
    render(<TopUpCard {...baseProps} description={undefined} />);
    expect(
      screen.queryByText("Best value for the average month"),
    ).not.toBeInTheDocument();
  });
});
