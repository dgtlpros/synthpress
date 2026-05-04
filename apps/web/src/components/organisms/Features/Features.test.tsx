import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Features } from "./Features";

afterEach(cleanup);

describe("Features", () => {
  it("renders section title", () => {
    render(<Features />);
    expect(screen.getByText(/Everything You Need/)).toBeInTheDocument();
  });

  it("renders all 6 feature cards", () => {
    render(<Features />);
    expect(screen.getByText("AI Article Generation")).toBeInTheDocument();
    expect(screen.getByText("Multi-Site Management")).toBeInTheDocument();
    expect(screen.getByText("Auto-Publishing")).toBeInTheDocument();
    expect(screen.getByText("MSN Syndication")).toBeInTheDocument();
    expect(screen.getByText("Image Generation")).toBeInTheDocument();
    expect(screen.getByText("SEO Optimized")).toBeInTheDocument();
  });
});
