import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ProjectInstalledAppRow } from "./ProjectInstalledAppRow";

afterEach(cleanup);

describe("ProjectInstalledAppRow", () => {
  it("renders link to href", () => {
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
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
