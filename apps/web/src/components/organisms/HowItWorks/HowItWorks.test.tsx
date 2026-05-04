import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { HowItWorks } from "./HowItWorks";

afterEach(cleanup);

describe("HowItWorks", () => {
  it("renders section title", () => {
    render(<HowItWorks />);
    expect(screen.getByText("How It Works")).toBeInTheDocument();
  });

  it("renders all three steps", () => {
    render(<HowItWorks />);
    expect(screen.getByText("Connect Your Site")).toBeInTheDocument();
    expect(screen.getByText("Generate Content")).toBeInTheDocument();
    expect(screen.getByText("Auto-Publish")).toBeInTheDocument();
  });

  it("renders step numbers", () => {
    render(<HowItWorks />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
