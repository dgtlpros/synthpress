import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComingSoonPanel } from "./ComingSoonPanel";

afterEach(cleanup);

describe("ComingSoonPanel", () => {
  it("renders title, description, and Coming soon badge", () => {
    render(
      <ComingSoonPanel
        title="Calendar"
        description="Visualize your cadence."
      />,
    );
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("Visualize your cadence.")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("renders bullet points when provided", () => {
    render(
      <ComingSoonPanel
        title="Queue"
        description="Track autopilot."
        bullets={["Upcoming", "Failed jobs"]}
      />,
    );
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("Failed jobs")).toBeInTheDocument();
  });
});
