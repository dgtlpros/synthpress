import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Pricing } from "./Pricing";

afterEach(cleanup);

describe("Pricing", () => {
  it("renders section title", () => {
    render(<Pricing />);
    expect(screen.getByText("Simple, Transparent Pricing")).toBeInTheDocument();
  });

  it("renders all 3 tiers", () => {
    render(<Pricing />);
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Scale")).toBeInTheDocument();
  });

  it("renders prices", () => {
    render(<Pricing />);
    expect(screen.getByText("$29")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
  });

  it("shows Most Popular badge on Pro", () => {
    render(<Pricing />);
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
  });
});
