import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BlogHeader } from "./BlogHeader";

afterEach(cleanup);

describe("BlogHeader", () => {
  it("renders name and description", () => {
    render(
      <BlogHeader
        name="Indie Hacker Stories"
        description="Stories about building bootstrapped products."
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Indie Hacker Stories" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Stories about building bootstrapped products."),
    ).toBeInTheDocument();
  });

  it("renders the manual badge when automationMode='manual'", () => {
    render(<BlogHeader name="X" automationMode="manual" />);
    expect(screen.getByText("Manual mode")).toBeInTheDocument();
  });

  it("renders the autopilot badge when automationMode='autopilot'", () => {
    render(<BlogHeader name="X" automationMode="autopilot" />);
    expect(screen.getByText("Autopilot on")).toBeInTheDocument();
  });

  it("renders actions slot", () => {
    render(
      <BlogHeader name="X" actions={<button type="button">Generate</button>} />,
    );
    expect(
      screen.getByRole("button", { name: "Generate" }),
    ).toBeInTheDocument();
  });

  it("renders children below the description", () => {
    render(
      <BlogHeader name="X" description="d">
        <span data-testid="child">child</span>
      </BlogHeader>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
