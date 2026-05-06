import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { TeamProjectsListConnector } from "./TeamProjectsListConnector";

afterEach(cleanup);

const projects = [
  { id: "p1", name: "Alpha", created_at: "2026-01-03" },
  { id: "p2", name: "Zebra", created_at: "2026-01-01" },
  { id: "p3", name: "Beta",  created_at: "2026-01-02" },
];

describe("TeamProjectsListConnector", () => {
  it("renders all projects sorted by name-asc by default", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={projects} />);
    const links = screen.getAllByRole("link");
    const names = links.map((l) => l.querySelector("span")?.textContent?.trim() ?? l.textContent?.trim());
    expect(names).toEqual(["Alpha", "Beta", "Zebra"]);
  });

  it("filters projects by search query (case-insensitive)", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={projects} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alp" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Zebra")).not.toBeInTheDocument();
  });

  it("shows empty list message when no projects match the search", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={projects} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText(/no projects match/i)).toBeInTheDocument();
  });

  it("sorts by name-desc when selected", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={projects} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "name-desc" } });
    const links = screen.getAllByRole("link");
    const names = links.map((l) => l.querySelector("span")?.textContent?.trim() ?? l.textContent?.trim());
    expect(names).toEqual(["Zebra", "Beta", "Alpha"]);
  });

  it("sorts by newest when selected", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={projects} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "newest" } });
    const links = screen.getAllByRole("link");
    const names = links.map((l) => l.querySelector("span")?.textContent?.trim() ?? l.textContent?.trim());
    // newest: p1(Jan 3) > p3(Jan 2) > p2(Jan 1) → Alpha, Beta, Zebra
    expect(names).toEqual(["Alpha", "Beta", "Zebra"]);
  });

  it("project links point to the correct href", () => {
    render(<TeamProjectsListConnector teamId="t1" projects={[projects[0]]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/teams/t1/projects/p1");
  });
});
