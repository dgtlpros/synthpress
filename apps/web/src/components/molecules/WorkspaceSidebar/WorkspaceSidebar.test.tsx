import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const mockPathname = vi.fn(() => "/dashboard");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

afterEach(cleanup);

const teams = [
  {
    id: "t-alpha",
    name: "Alpha Team",
    projects: [
      { id: "p-1", name: "Project One", teamId: "t-alpha" },
      { id: "p-2", name: "Project Two", teamId: "t-alpha" },
    ],
  },
  { id: "t-beta", name: "Beta", projects: [] },
];

beforeEach(() => {
  mockPathname.mockReturnValue("/dashboard");
});

describe("WorkspaceSidebar", () => {
  it("renders Dashboard and Account links", () => {
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("renders All teams link to /teams root", () => {
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "All teams" })).toHaveAttribute("href", "/teams");
  });

  it("marks All teams link current on /teams", () => {
    mockPathname.mockReturnValue("/teams");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "All teams" })).toHaveAttribute("aria-current", "page");
  });

  it("shows project links only for the active team in the URL", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects/p-1");
    render(<WorkspaceSidebar teams={teams} />);

    expect(screen.getByRole("link", { name: "Project One" })).toHaveAttribute(
      "href",
      "/teams/t-alpha/projects/p-1",
    );
    expect(screen.getByRole("link", { name: "Project Two" })).toHaveAttribute(
      "href",
      "/teams/t-alpha/projects/p-2",
    );
    expect(screen.queryByRole("link", { name: /Beta/i })).not.toBeInTheDocument();
  });

  it("marks Dashboard as current on /dashboard", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("marks Account as current under /account", () => {
    mockPathname.mockReturnValue("/account/billing");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");
  });

  it("opens team picker and lists teams", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose or switch team" }));

    expect(screen.getByRole("listbox", { name: "Switch team" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Alpha Team/i })).toHaveAttribute(
      "href",
      "/teams/t-alpha/projects",
    );
    expect(screen.getByRole("option", { name: /Beta/i })).toHaveAttribute("href", "/teams/t-beta/projects");
  });

  it("invokes onItemClick when a project link is clicked", () => {
    const onItemClick = vi.fn();
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("link", { name: "Project One" }));
    expect(onItemClick).toHaveBeenCalled();
  });

  it("renders user email when provided", () => {
    render(<WorkspaceSidebar teams={[]} email="user@test.com" />);
    expect(screen.getByText("user@test.com")).toBeInTheDocument();
  });
});
