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
});
