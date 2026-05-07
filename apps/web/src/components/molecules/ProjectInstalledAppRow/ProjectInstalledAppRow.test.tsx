import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ProjectInstalledAppRow } from "./ProjectInstalledAppRow";

afterEach(cleanup);

describe("ProjectInstalledAppRow", () => {
  it("renders link to href and an Active badge in the lime variant", () => {
    render(
      <ProjectInstalledAppRow
        href="/t/p/b/1"
        appKindLabel="Blog"
        title="Main"
        subtitle="https://wp.test"
        isActive
      />,
    );
    const link = screen.getByRole("link", { name: /Main/i });
    expect(link).toHaveAttribute("href", "/t/p/b/1");
    expect(screen.getByText("Blog")).toBeInTheDocument();
    const activeBadge = screen.getByText("Active");
    expect(activeBadge).toBeInTheDocument();
    expect(activeBadge.className).toMatch(/brand-lime/);
  });

  it("renders Paused badge when isActive is false", () => {
    render(
      <ProjectInstalledAppRow
        href="/t/p/b/2"
        appKindLabel="Blog"
        title="Backup"
        subtitle="https://wp2.test"
        isActive={false}
      />,
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
