import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PricingCard } from "./PricingCard";

afterEach(cleanup);

const baseProps = {
  name: "Pro",
  price: "$79",
  description: "For growing networks",
  features: ["5 sites", "150 articles/mo"],
};

describe("PricingCard", () => {
  it("renders name, price, and features", () => {
    render(<PricingCard {...baseProps} />);
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("5 sites")).toBeInTheDocument();
    expect(screen.getByText("150 articles/mo")).toBeInTheDocument();
  });

  it("shows Most Popular badge when popular", () => {
    render(<PricingCard {...baseProps} popular />);
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
  });

  it("does not show badge when not popular", () => {
    render(<PricingCard {...baseProps} />);
    expect(screen.queryByText("Most Popular")).not.toBeInTheDocument();
  });

  it("renders CTA with correct href", () => {
    render(<PricingCard {...baseProps} ctaHref="/signup" ctaLabel="Sign Up" />);
    expect(screen.getByText("Sign Up")).toHaveAttribute("href", "/signup");
  });

  it("renders default CTA label", () => {
    render(<PricingCard {...baseProps} />);
    expect(screen.getByText("Get Started")).toBeInTheDocument();
  });
});
