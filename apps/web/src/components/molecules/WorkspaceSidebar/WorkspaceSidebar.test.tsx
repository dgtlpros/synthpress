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

  it("shows gear icon button when a team is active in the route", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("button", { name: /team settings/i })).toBeInTheDocument();
  });

  it("does not show gear icon when no team is active", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.queryByRole("button", { name: /team settings/i })).not.toBeInTheDocument();
  });

  it("opens settings popover with Settings and Usage links on gear click", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);

    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/teams/t-alpha/settings",
    );
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/teams/t-alpha/usage",
    );
  });

  it("closes settings popover when gear is clicked again", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);

    const gearBtn = screen.getByRole("button", { name: /team settings/i });
    fireEvent.click(gearBtn);
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();

    fireEvent.click(gearBtn);
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("closes settings popover and opens team picker when team button is clicked", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);

    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes team picker on outside mousedown", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} />);

    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes settings popover on Escape keypress", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);

    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("calls onItemClick and closes picker when a team option is clicked", () => {
    const onItemClick = vi.fn();
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    fireEvent.click(screen.getByRole("option", { name: /Alpha Team/i }));
    expect(onItemClick).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes settings popover and calls onItemClick when a popover link is clicked", () => {
    const onItemClick = vi.fn();
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(onItemClick).toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("renders sorted teams alphabetically in the picker", () => {
    mockPathname.mockReturnValue("/dashboard");
    const unsorted = [
      { id: "t-zebra", name: "Zebra", projects: [] },
      { id: "t-alpha", name: "Alpha Team", projects: [] },
    ];
    render(<WorkspaceSidebar teams={unsorted} />);
    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Alpha Team");
    expect(options[1]).toHaveTextContent("Zebra");
  });

  it("shows 'No projects yet' for an active team with no projects", () => {
    mockPathname.mockReturnValue("/teams/t-beta/projects");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("shows null activeTeam when activeTeamId does not match any team", () => {
    mockPathname.mockReturnValue("/teams/t-nonexistent/projects");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
  });

  it("cleanup removes event listeners (no errors on unmount)", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    const { unmount } = render(<WorkspaceSidebar teams={teams} />);
    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    unmount();
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
  });

  it("marks Dashboard as current on root path '/'", () => {
    mockPathname.mockReturnValue("/");
    render(<WorkspaceSidebar teams={teams} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("does not close popover on mousedown inside the team picker element", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<WorkspaceSidebar teams={teams} />);
    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    const listbox = screen.getByRole("listbox", { name: "Switch team" });
    fireEvent.mouseDown(listbox);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("handles null pathname without error (accountActive ?? false)", () => {
    mockPathname.mockReturnValue(null as unknown as string);
    expect(() => render(<WorkspaceSidebar teams={teams} />)).not.toThrow();
  });

  it("shows '?' initial for a team with empty name", () => {
    mockPathname.mockReturnValue("/dashboard");
    const emptyNameTeams = [{ id: "t-empty", name: "  ", projects: [] }];
    render(<WorkspaceSidebar teams={emptyNameTeams} />);
    fireEvent.click(screen.getByRole("button", { name: /choose or switch team/i }));
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("ignores non-Escape keydown when popover is open", () => {
    mockPathname.mockReturnValue("/teams/t-alpha/projects");
    render(<WorkspaceSidebar teams={teams} />);
    fireEvent.click(screen.getByRole("button", { name: /team settings/i }));
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});
