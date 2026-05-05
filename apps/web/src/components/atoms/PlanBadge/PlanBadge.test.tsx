import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PlanBadge } from "./PlanBadge";

afterEach(cleanup);

describe("PlanBadge", () => {
  it("renders just the plan name when active", () => {
    render(<PlanBadge planName="Pro" status="active" />);
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("annotates trialing/past_due/canceled with a suffix", () => {
    const cases: Array<["trialing" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused", string]> = [
      ["trialing", "Trialing"],
      ["past_due", "Past due"],
      ["canceled", "Canceled"],
      ["incomplete", "Incomplete"],
      ["unpaid", "Unpaid"],
      ["paused", "Paused"],
    ];

    for (const [status, suffix] of cases) {
      const { unmount } = render(<PlanBadge planName="Pro" status={status} />);
      expect(screen.getByText(`Pro · ${suffix}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders free without a status suffix", () => {
    render(<PlanBadge planName="Free" status="free" />);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("defaults to active when no status is given", () => {
    render(<PlanBadge planName="Starter" />);
    expect(screen.getByText("Starter")).toBeInTheDocument();
  });
});
