import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { LandingLayout } from "./LandingLayout";

afterEach(cleanup);

describe("LandingLayout", () => {
  it("renders children", () => {
    render(<LandingLayout><div>Page content</div></LandingLayout>);
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("renders navbar", () => {
    render(<LandingLayout><div>Content</div></LandingLayout>);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });
});
