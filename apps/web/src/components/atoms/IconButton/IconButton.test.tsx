import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { IconButton } from "./IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("renders with accessible label", () => {
    render(<IconButton label="Close">X</IconButton>);
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("handles click events", () => {
    const onClick = vi.fn();
    render(<IconButton label="Close" onClick={onClick}>X</IconButton>);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders all variants", () => {
    const variants = ["default", "ghost", "brand"] as const;
    variants.forEach((variant) => {
      const { unmount } = render(<IconButton label="Test" variant={variant}>X</IconButton>);
      expect(screen.getByLabelText("Test")).toBeInTheDocument();
      unmount();
    });
  });

  it("applies disabled styling", () => {
    render(<IconButton label="Disabled" disabled>X</IconButton>);
    expect(screen.getByLabelText("Disabled")).toBeDisabled();
    expect(screen.getByLabelText("Disabled").className).toContain("opacity-50");
  });
});
