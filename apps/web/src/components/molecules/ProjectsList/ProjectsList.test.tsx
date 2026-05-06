import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ProjectsList } from "./ProjectsList";

afterEach(cleanup);

describe("ProjectsList", () => {
  it("renders project links", () => {
    render(
      <ProjectsList
        teamId="t1"
        projects={[
          { id: "p1", name: "Alpha" },
          { id: "p2", name: "Beta" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Alpha/i })).toHaveAttribute("href", "/teams/t1/projects/p1");
  });

  it("shows empty filter message", () => {
    render(<ProjectsList teamId="t1" projects={[]} />);
    expect(screen.getByText(/No projects match/)).toBeInTheDocument();
  });
});
