import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamListItem } from "./TeamListItem";

describe("TeamListItem", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders team name, owner label, stats, and plan badge for Free", () => {
    render(
      <TeamListItem
        href="/teams/t1/projects"
        name="Acme"
        ownerLabel="Owned by Pat"
        ownerInitials="P"
        memberCount={3}
        projectCount={2}
        planDisplayName="Free"
        planStatus={null}
        balance={0}
      />,
    );

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Owned by Pat")).toBeInTheDocument();
    expect(screen.getByText("3 members · 2 projects")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme/ })).toHaveAttribute(
      "href",
      "/teams/t1/projects",
    );
  });

  it("uses aria-label that summarizes the row", () => {
    render(
      <TeamListItem
        href="/teams/t1/projects"
        name="Beta"
        ownerLabel="You"
        ownerInitials="Y"
        memberCount={1}
        projectCount={1}
        planDisplayName="Pro"
        planStatus="active"
        balance={1200}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "Beta. You. 1 member · 1 project. Pro. 1,200 tokens.",
      }),
    ).toBeInTheDocument();
  });

  it("normalizes null planStatus to active for paid plans", () => {
    render(
      <TeamListItem
        href="/teams/t1/projects"
        name="C"
        ownerLabel="O"
        ownerInitials="O"
        memberCount={1}
        projectCount={0}
        planDisplayName="Pro"
        planStatus={null}
        balance={0}
      />,
    );
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("normalizes unknown planStatus to active for paid plans", () => {
    render(
      <TeamListItem
        href="/teams/t1/projects"
        name="D"
        ownerLabel="O"
        ownerInitials="O"
        memberCount={1}
        projectCount={0}
        planDisplayName="Enterprise"
        planStatus="some_unknown_status"
        balance={0}
      />,
    );
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
  });
});
