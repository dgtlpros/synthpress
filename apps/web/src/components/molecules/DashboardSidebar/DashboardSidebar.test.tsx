import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DashboardSidebar } from "./DashboardSidebar";

afterEach(cleanup);

const items = [
  { label: "Dashboard", href: "/dashboard", isActive: true },
  { label: "Projects", href: "/projects" },
  { label: "Account", href: "/account" },
];

describe("DashboardSidebar", () => {
  it("renders all nav items as links", () => {
    render(<DashboardSidebar navItems={items} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("marks the active item with aria-current", () => {
    render(<DashboardSidebar navItems={items} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current");
  });

  it("renders the user email when provided", () => {
    render(<DashboardSidebar navItems={items} email="user@test.com" />);
    expect(screen.getByText("user@test.com")).toBeInTheDocument();
  });

  it("omits the email block when no email passed", () => {
    render(<DashboardSidebar navItems={items} />);
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("invokes onItemClick when a link is clicked", () => {
    const onItemClick = vi.fn();
    render(<DashboardSidebar navItems={items} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("link", { name: "Projects" }));
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it("invokes onItemClick when the logo link is clicked", () => {
    const onItemClick = vi.fn();
    render(<DashboardSidebar navItems={items} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("link", { name: "Go to home" }));
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });
});
