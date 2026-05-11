import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  AUTOPILOT_RUN_STATUSES,
  AutopilotRunStatusBadge,
  getAutopilotRunStatusLabel,
} from "./AutopilotRunStatusBadge";

afterEach(cleanup);

describe("AutopilotRunStatusBadge", () => {
  it.each([
    ["pending", "Queued"],
    ["processing", "Running"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["skipped", "Skipped"],
  ])("renders the %s label as '%s'", (status, expected) => {
    render(
      <AutopilotRunStatusBadge status={status as never} />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("forwards size + className to the Badge", () => {
    render(
      <AutopilotRunStatusBadge
        status="completed"
        size="md"
        className="my-class"
      />,
    );
    expect(screen.getByText("Completed").className).toContain("my-class");
  });

  it("exports a stable list of every status", () => {
    expect([...AUTOPILOT_RUN_STATUSES]).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
      "skipped",
    ]);
  });

  it("exposes the label map via getAutopilotRunStatusLabel", () => {
    expect(getAutopilotRunStatusLabel("processing")).toBe("Running");
    expect(getAutopilotRunStatusLabel("skipped")).toBe("Skipped");
  });
});
