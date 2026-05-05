import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PricingTableConnector, type PricingTablePlan } from "./PricingTableConnector";

afterEach(cleanup);

const plans: PricingTablePlan[] = [
  {
    key: "starter",
    name: "Starter",
    description: "For solo creators",
    monthlyPriceCents: 2900,
    annualPriceCents: 29000,
    features: ["1 site"],
    isPopular: false,
  },
  {
    key: "pro",
    name: "Pro",
    description: "For growing networks",
    monthlyPriceCents: 7900,
    annualPriceCents: 79000,
    features: ["5 sites"],
    isPopular: true,
  },
  {
    key: "scale",
    name: "Scale",
    description: "For agencies",
    monthlyPriceCents: 19900,
    annualPriceCents: null,
    features: ["20 sites"],
    isPopular: false,
  },
];

describe("PricingTableConnector", () => {
  it("renders monthly prices and CTAs by default", () => {
    render(<PricingTableConnector plans={plans} authed />);
    expect(screen.getByText("$29")).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();

    expect(screen.getAllByText("/mo").length).toBe(3);

    const proCta = screen.getAllByRole("link", { name: "Subscribe" }).find((el) =>
      el.getAttribute("href")?.includes("plan=pro"),
    );
    expect(proCta).toBeDefined();
    expect(proCta).toHaveAttribute("href", "/checkout?plan=pro");
  });

  it("switches to annual prices and yearly hrefs when toggled", () => {
    render(<PricingTableConnector plans={plans} authed />);
    fireEvent.click(screen.getByRole("tab", { name: /Annual/ }));

    expect(screen.getByText("$290")).toBeInTheDocument();
    expect(screen.getByText("$790")).toBeInTheDocument();

    const proCta = screen.getAllByRole("link", { name: "Subscribe" }).find((el) =>
      el.getAttribute("href")?.includes("plan=pro"),
    );
    expect(proCta).toHaveAttribute("href", "/checkout?plan=pro&interval=year");
  });

  it("falls back to monthly price for plans without an annual price", () => {
    render(<PricingTableConnector plans={plans} authed />);
    fireEvent.click(screen.getByRole("tab", { name: /Annual/ }));

    // Scale still shows $199 (no annual configured)
    expect(screen.getByText("$199")).toBeInTheDocument();

    const scaleCta = screen.getAllByRole("link", { name: "Subscribe" }).find((el) =>
      el.getAttribute("href")?.includes("plan=scale"),
    );
    // No interval=year since plan has no annual price
    expect(scaleCta).toHaveAttribute("href", "/checkout?plan=scale");
  });

  it("routes unauthenticated users through /signup with the checkout target", () => {
    render(<PricingTableConnector plans={plans} authed={false} />);
    const expectedHref = "/signup?next=" + encodeURIComponent("/checkout?plan=pro");
    const proCta = screen
      .getAllByRole("link", { name: "Get Started" })
      .find((el) => el.getAttribute("href") === expectedHref);
    expect(proCta).toBeDefined();
    expect(proCta).toHaveAttribute("href", expectedHref);
  });

  it("hides the toggle when no plans support annual pricing", () => {
    const monthlyOnly = plans.map((p) => ({ ...p, annualPriceCents: null }));
    render(<PricingTableConnector plans={monthlyOnly} authed />);
    expect(screen.queryByRole("tablist", { name: "Billing interval" })).not.toBeInTheDocument();
  });

  it("marks the popular tier", () => {
    render(<PricingTableConnector plans={plans} authed />);
    const popularCard = screen.getByText("Most Popular").closest("div");
    expect(popularCard).not.toBeNull();
    expect(within(popularCard as HTMLElement).getByText("Pro")).toBeInTheDocument();
  });
});
