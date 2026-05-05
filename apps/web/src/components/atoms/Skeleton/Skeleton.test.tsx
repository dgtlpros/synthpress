import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Skeleton } from "./Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("renders with the loading status role and aria attributes", () => {
    render(<Skeleton className="h-6 w-32" />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("aria-busy", "true");
    expect(node).toHaveAttribute("aria-label", "Loading");
    expect(node.className).toContain("animate-pulse");
  });

  it("renders all variants", () => {
    for (const variant of ["rect", "pill", "circle"] as const) {
      const { unmount } = render(<Skeleton variant={variant} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      unmount();
    }
  });

  it("merges custom className", () => {
    render(<Skeleton className="custom-x" />);
    expect(screen.getByRole("status").className).toContain("custom-x");
  });
});
