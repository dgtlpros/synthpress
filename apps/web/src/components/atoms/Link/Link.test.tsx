import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Link } from "./Link";

afterEach(cleanup);

describe("Link", () => {
  it("renders with text and href", () => {
    render(<Link href="/about">About</Link>);
    const link = screen.getByRole("link", { name: "About" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/about");
  });

  it("renders all variants", () => {
    const variants = ["default", "muted", "nav"] as const;
    variants.forEach((variant) => {
      const { unmount } = render(<Link variant={variant} href="#">{variant}</Link>);
      expect(screen.getByRole("link")).toBeInTheDocument();
      unmount();
    });
  });

  it("uses next/link for internal routes", () => {
    render(<Link href="/dashboard">Dashboard</Link>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("uses native <a> for anchor links", () => {
    render(<Link href="#section">Jump</Link>);
    expect(screen.getByRole("link", { name: "Jump" })).toHaveAttribute("href", "#section");
  });

  it("uses native <a> with target _blank for external links", () => {
    render(<Link href="https://example.com">External</Link>);
    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("has cursor-pointer class", () => {
    render(<Link href="/test">Test</Link>);
    expect(screen.getByRole("link")).toHaveClass("cursor-pointer");
  });
});
