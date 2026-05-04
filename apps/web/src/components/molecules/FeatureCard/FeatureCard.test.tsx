import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { FeatureCard } from "./FeatureCard";

afterEach(cleanup);

describe("FeatureCard", () => {
  it("renders icon, title, and description", () => {
    render(<FeatureCard icon="⚡" title="Fast" description="Lightning fast publishing" />);
    expect(screen.getByText("⚡")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Lightning fast publishing")).toBeInTheDocument();
  });
});
