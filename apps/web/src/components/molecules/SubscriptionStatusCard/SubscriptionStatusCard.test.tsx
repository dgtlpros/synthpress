import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";

afterEach(cleanup);

describe("SubscriptionStatusCard", () => {
  it("renders a monthly plan with renewal date, price, and 'Billed monthly' tag", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        planDescription="For growing networks"
        status="active"
        priceCents={7900}
        interval="month"
        currentPeriodEnd="2026-06-01T00:00:00Z"
      />,
    );

    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("For growing networks")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("/mo")).toBeInTheDocument();
    expect(screen.getByText("Billed monthly")).toBeInTheDocument();
    expect(screen.getByText(/^Renews on/)).toBeInTheDocument();
  });

  it("renders an annual plan with annual price, '/yr' period, and 'Billed annually' tag", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        planDescription="For growing networks"
        status="active"
        priceCents={79000}
        interval="year"
        currentPeriodEnd="2027-05-05T00:00:00Z"
      />,
    );

    expect(screen.getByText("$790")).toBeInTheDocument();
    expect(screen.getByText("/yr")).toBeInTheDocument();
    expect(screen.getByText("Billed annually")).toBeInTheDocument();
    expect(screen.getByText(/Renews annually on/)).toBeInTheDocument();
  });

  it("renders cancellation note and Canceling badge when cancel_at_period_end is true", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="active"
        priceCents={7900}
        interval="month"
        currentPeriodEnd="2026-06-01T00:00:00Z"
        cancelAtPeriodEnd
      />,
    );
    expect(screen.getByText(/Subscription ends on/)).toBeInTheDocument();
    expect(screen.getByText("Pro · Canceling")).toBeInTheDocument();
  });

  it("keeps the underlying status badge when cancel_at_period_end is false", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="past_due"
        priceCents={7900}
        interval="month"
        currentPeriodEnd="2026-06-01T00:00:00Z"
      />,
    );
    expect(screen.getByText("Pro · Past due")).toBeInTheDocument();
  });

  it("treats cancel_at_period_end on a trialing sub as Canceling", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="trialing"
        priceCents={7900}
        interval="month"
        currentPeriodEnd="2026-06-01T00:00:00Z"
        cancelAtPeriodEnd
      />,
    );
    expect(screen.getByText("Pro · Canceling")).toBeInTheDocument();
  });

  it("doesn't promote a non-active status to canceling even if flagged", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="past_due"
        priceCents={7900}
        interval="month"
        currentPeriodEnd="2026-06-01T00:00:00Z"
        cancelAtPeriodEnd
      />,
    );
    expect(screen.getByText("Pro · Past due")).toBeInTheDocument();
  });

  it("uses the cancellation copy on annual subs too", () => {
    render(
      <SubscriptionStatusCard
        planName="Pro"
        status="active"
        priceCents={79000}
        interval="year"
        currentPeriodEnd="2027-05-05T00:00:00Z"
        cancelAtPeriodEnd
      />,
    );
    // Cancellation copy wins over the cadence-aware "Renews annually" copy.
    expect(screen.getByText(/Subscription ends on/)).toBeInTheDocument();
    expect(screen.queryByText(/Renews annually/)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/Renews annually/)).not.toBeInTheDocument();
  });
});
