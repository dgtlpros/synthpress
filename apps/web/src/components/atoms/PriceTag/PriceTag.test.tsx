import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PriceTag } from "./PriceTag";

afterEach(cleanup);

describe("PriceTag", () => {
  it("formats whole dollars without decimals", () => {
    render(<PriceTag cents={2900} />);
    expect(screen.getByText("$29")).toBeInTheDocument();
  });

  it("formats partial dollars with two decimals", () => {
    render(<PriceTag cents={2999} />);
    expect(screen.getByText("$29.99")).toBeInTheDocument();
  });

  it("renders period suffix when provided", () => {
    render(<PriceTag cents={7900} period="/mo" />);
    expect(screen.getByText("/mo")).toBeInTheDocument();
  });

  it("supports custom currency", () => {
    render(<PriceTag cents={1000} currency="EUR" />);
    expect(screen.getByText("€10")).toBeInTheDocument();
  });

  it("renders all size variants", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = render(<PriceTag cents={1900} size={size} />);
      expect(screen.getByText("$19")).toBeInTheDocument();
      unmount();
    }
  });
});
