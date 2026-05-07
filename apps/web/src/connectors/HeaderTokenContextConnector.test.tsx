import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mockPathname = vi.fn(() => "/dashboard");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

import {
  HeaderTokenContextConnector,
  type HeaderTeamPlan,
} from "./HeaderTokenContextConnector";

const teamPlans: HeaderTeamPlan[] = [
  {
    teamId: "t-acme",
    teamName: "Acme",
    ownerName: "Owen",
    isOwner: false,
    myRole: "member",
    balance: 250,
    planKey: "pro",
  },
  {
    teamId: "t-self",
    teamName: "Personal",
    ownerName: "Me",
    isOwner: true,
    myRole: "owner",
    balance: 30,
    planKey: null,
  },
  {
    teamId: "t-healthy",
    teamName: "Healthy",
    ownerName: "Helen",
    isOwner: false,
    myRole: "admin",
    balance: 9_999,
    planKey: "scale",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue("/dashboard");
});

afterEach(cleanup);

describe("HeaderTokenContextConnector", () => {
  it("renders personal balance link outside team routes", () => {
    render(
      <HeaderTokenContextConnector
        personalBalance={150}
        teamPlans={teamPlans}
      />,
    );
    const link = screen.getByRole("link", { name: /view billing/i });
    expect(link).toHaveAttribute("href", "/account/billing");
    expect(link.textContent).toContain("150 tokens");
  });

  it("renders team balance link with owner attribution and role for members", () => {
    mockPathname.mockReturnValue("/teams/t-acme/projects");
    render(
      <HeaderTokenContextConnector
        personalBalance={150}
        teamPlans={teamPlans}
      />,
    );
    const link = screen.getByRole("link", {
      name: /spending acme balance \(paid by owen\) · member/i,
    });
    expect(link).toHaveAttribute("href", "/teams/t-acme/usage");
    expect(link.textContent).toContain("250 tokens");
  });

  it("shows Admin role label for admin users", () => {
    const adminPlans: HeaderTeamPlan[] = [{ ...teamPlans[0], myRole: "admin" }];
    mockPathname.mockReturnValue("/teams/t-acme/projects");
    render(
      <HeaderTokenContextConnector
        personalBalance={150}
        teamPlans={adminPlans}
      />,
    );
    expect(
      screen.getByRole("link", {
        name: /spending acme balance \(paid by owen\) · admin/i,
      }),
    ).toBeInTheDocument();
  });

  it("links owner-of-team users to their own billing", () => {
    mockPathname.mockReturnValue("/teams/t-self/projects/foo");
    render(
      <HeaderTokenContextConnector
        personalBalance={999}
        teamPlans={teamPlans}
      />,
    );
    const link = screen.getByRole("link", {
      name: /spending your balance for personal/i,
    });
    expect(link).toHaveAttribute("href", "/account/billing");
    expect(link.textContent).toContain("30 tokens");
  });

  it("falls back to personal balance when team id is unknown", () => {
    mockPathname.mockReturnValue("/teams/unknown-team/projects");
    render(
      <HeaderTokenContextConnector
        personalBalance={42}
        teamPlans={teamPlans}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/account/billing",
    );
  });

  it("uses warning variant when team balance is low", () => {
    mockPathname.mockReturnValue("/teams/t-self/projects");
    const { container } = render(
      <HeaderTokenContextConnector
        personalBalance={500}
        teamPlans={teamPlans}
      />,
    );
    // t-self has balance 30 (≤50) => warning variant uses bg-warning class.
    const badge = container.querySelector(".bg-warning\\/10");
    expect(badge).not.toBeNull();
    expect(screen.getByText("30 tokens")).toBeInTheDocument();
  });

  it("uses the lime variant for any team balance above the warning threshold", () => {
    mockPathname.mockReturnValue("/teams/t-healthy/projects");
    const { container } = render(
      <HeaderTokenContextConnector
        personalBalance={500}
        teamPlans={teamPlans}
      />,
    );
    expect(container.querySelector(".bg-gradient-lime")).not.toBeNull();
    expect(screen.getByText("9,999 tokens")).toBeInTheDocument();
  });

  it("uses the lime variant for a personal balance above the warning threshold", () => {
    const { container } = render(
      <HeaderTokenContextConnector
        personalBalance={9_999}
        teamPlans={teamPlans}
      />,
    );
    expect(container.querySelector(".bg-gradient-lime")).not.toBeNull();
  });

  it("uses the lime variant even for modest balances above the warning threshold", () => {
    mockPathname.mockReturnValue("/teams/t-acme/projects");
    const { container } = render(
      <HeaderTokenContextConnector
        personalBalance={500}
        teamPlans={teamPlans}
      />,
    );
    // t-acme has balance 250 — above the 50 threshold, so lime applies.
    expect(container.querySelector(".bg-gradient-lime")).not.toBeNull();
  });
});
