import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { MobileNavConnector } from "./MobileNavConnector";

afterEach(cleanup);

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Account", href: "/account" },
];

describe("MobileNavConnector", () => {
  it("renders the open-menu trigger collapsed by default", () => {
    render(<MobileNavConnector navItems={navItems} />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles the drawer when the trigger is clicked", () => {
    render(<MobileNavConnector navItems={navItems} />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer.className).toContain("translate-x-0");
  });

  it("closes the drawer when a nav link is clicked", () => {
    render(<MobileNavConnector navItems={navItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    fireEvent.click(screen.getByRole("link", { name: "Account" }));

    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes the drawer when the backdrop is clicked", () => {
    render(<MobileNavConnector navItems={navItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    fireEvent.click(screen.getByTestId("mobile-nav-backdrop"));
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("closes the drawer on Escape", () => {
    render(<MobileNavConnector navItems={navItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("ignores other keys", () => {
    render(<MobileNavConnector navItems={navItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();
  });

  it("propagates email to the inner sidebar", () => {
    render(<MobileNavConnector navItems={navItems} email="user@test.com" />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByText("user@test.com")).toBeInTheDocument();
  });

  it("locks body scroll while open and restores on close", () => {
    render(<MobileNavConnector navItems={navItems} />);
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("mobile-nav-backdrop"));
    expect(document.body.style.overflow).toBe("");
  });
});
