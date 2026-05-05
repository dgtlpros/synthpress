import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { BillingSection } from "./BillingSection";

afterEach(cleanup);

const proPlan = {
  name: "Pro",
  description: "For growing networks",
  priceCents: 7900,
  monthlyTokens: 5000,
};

const proAnnualPlan = {
  name: "Pro",
  description: "For growing networks",
  priceCents: 79000,
  monthlyTokens: 5000,
};

const sampleTopUps = [
  {
    key: "pack_500",
    name: "500 synth tokens",
    description: "Quick top-up",
    tokens: 500,
    priceCents: 1900,
    ctaHref: "/checkout?pack=pack_500",
  },
];

const sampleTransactions = [
  {
    id: "t1",
    amount: 100,
    type: "signup_grant",
    description: "Welcome bonus",
    created_at: "2026-05-01T00:00:00Z",
  },
  {
    id: "t2",
    amount: -10,
    type: "usage",
    description: null,
    created_at: "2026-05-02T00:00:00Z",
  },
  {
    id: "t3",
    amount: 5,
    type: "custom_kind",
    description: "Manual",
    created_at: "not-a-date",
  },
  {
    id: "t4",
    amount: 0,
    type: "subscription_canceled",
    description: "Subscription scheduled to end on June 5, 2026",
    created_at: "2026-05-03T00:00:00Z",
  },
];

describe("BillingSection", () => {
  it("renders the free state when there is no plan or subscription", () => {
    render(
      <BillingSection
        plan={null}
        subscription={null}
        balance={100}
        transactions={[]}
        topUpPacks={[]}
      />,
    );

    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText(/free plan/)).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("No token activity yet")).toBeInTheDocument();
    expect(screen.getByText(/Subscription grants, top-ups/)).toBeInTheDocument();
  });

  it("renders an active monthly subscription with renewal copy", () => {
    render(
      <BillingSection
        plan={proPlan}
        subscription={{
          status: "active",
          currentPeriodEnd: "2026-06-01T00:00:00Z",
          cancelAtPeriodEnd: false,
          interval: "month",
        }}
        balance={5400}
        transactions={[]}
        topUpPacks={[]}
      />,
    );

    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("/mo")).toBeInTheDocument();
    expect(screen.getByText("Billed monthly")).toBeInTheDocument();
    expect(screen.getByText(/^Renews on/)).toBeInTheDocument();
    expect(screen.getByText("5,400")).toBeInTheDocument();
    expect(screen.getByText(/Includes 5,000 tokens/)).toBeInTheDocument();
  });

  it("renders an annual subscription with the annual price and 'Renews annually' copy", () => {
    render(
      <BillingSection
        plan={proAnnualPlan}
        subscription={{
          status: "active",
          currentPeriodEnd: "2027-05-05T00:00:00Z",
          cancelAtPeriodEnd: false,
          interval: "year",
        }}
        balance={60000}
        transactions={[]}
        topUpPacks={[]}
      />,
    );

    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("$790")).toBeInTheDocument();
    expect(screen.getByText("/yr")).toBeInTheDocument();
    expect(screen.getByText("Billed annually")).toBeInTheDocument();
    expect(screen.getByText(/Renews annually on/)).toBeInTheDocument();
  });

  it("renders the top-up packs section when packs are provided", () => {
    render(
      <BillingSection
        plan={proPlan}
        subscription={{ status: "active" }}
        balance={1000}
        transactions={[]}
        topUpPacks={sampleTopUps}
      />,
    );

    expect(screen.getByText("One-time top-ups")).toBeInTheDocument();
    expect(screen.getByText("500 synth tokens")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buy now" })).toHaveAttribute(
      "href",
      "/checkout?pack=pack_500",
    );
  });

  it("renders custom CTA labels for packs", () => {
    render(
      <BillingSection
        plan={null}
        subscription={null}
        balance={0}
        transactions={[]}
        topUpPacks={[{ ...sampleTopUps[0], ctaLabel: "Add to balance" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Add to balance" })).toBeInTheDocument();
  });

  it("renders a recent transactions table with formatted dates and signed amounts", () => {
    render(
      <BillingSection
        plan={null}
        subscription={null}
        balance={0}
        transactions={sampleTransactions}
        topUpPacks={[]}
      />,
    );

    expect(screen.getAllByText("Welcome bonus").length).toBeGreaterThan(0);
    expect(screen.getByText("+100")).toBeInTheDocument();
    expect(screen.getByText("-10")).toBeInTheDocument();
    expect(screen.getByText("AI usage")).toBeInTheDocument();
    expect(screen.getByText("custom_kind")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
    // Two "—" cells: one for the null description on the usage row, one for
    // the 0-amount lifecycle row.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Subscription canceled")).toBeInTheDocument();
    expect(
      screen.getByText("Subscription scheduled to end on June 5, 2026"),
    ).toBeInTheDocument();
  });

  it("falls back to 'active' status when plan is set but subscription is null", () => {
    render(
      <BillingSection
        plan={proPlan}
        subscription={null}
        balance={1000}
        transactions={[]}
        topUpPacks={[]}
      />,
    );
    expect(screen.getByText("Pro")).toBeInTheDocument();
    // No "free plan" blurb since we computed status='active' from the plan
    expect(screen.queryByText(/free plan/)).not.toBeInTheDocument();
  });

  it("renders subscriptionActions in the subscription card footer", () => {
    render(
      <BillingSection
        plan={proPlan}
        subscription={{ status: "active" }}
        balance={1000}
        transactions={[]}
        topUpPacks={[]}
        subscriptionActions={<button>Manage</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });
});
