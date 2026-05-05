import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";

afterEach(cleanup);

describe("SubscriptionStatusCard", () => {
  it("renders an active plan with renewal date and price", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        planDescription="For growing networks"
        status="active"
        monthlyPriceCents={7900}
        currentPeriodEnd="2026-06-01T00:00:00Z"
      />,
    );

    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("For growing networks")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText(/Renews on/)).toBeInTheDocument();
  });

  it("renders cancellation note when cancel_at_period_end is true", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="active"
        monthlyPriceCents={7900}
        currentPeriodEnd="2026-06-01T00:00:00Z"
        cancelAtPeriodEnd
      />,
    );
    expect(screen.getByText(/Subscription ends on/)).toBeInTheDocument();
  });

  it("shows the canceled note for canceled status", () => {
    render(<SubscriptionStatusCard planName="Pro" status="canceled" />);
    expect(screen.getByText("Subscription canceled.")).toBeInTheDocument();
  });

  it("shows the free-plan blurb for free status", () => {
    render(<SubscriptionStatusCard planName="Free" status="free" />);
    expect(screen.getByText(/free plan/)).toBeInTheDocument();
    expect(screen.queryByText(/\/mo/)).not.toBeInTheDocument();
  });

  it("renders provided actions", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="active"
        actions={<button>Manage</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("ignores invalid period end values", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="active"
        currentPeriodEnd="not-a-date"
      />,
    );
    expect(screen.queryByText(/Renews on/)).not.toBeInTheDocument();
  });
});
