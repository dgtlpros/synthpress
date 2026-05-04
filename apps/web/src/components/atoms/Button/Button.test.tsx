import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders with text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("handles click events", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows spinner when loading", () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("is disabled when loading", () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not fire click when disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders all variants without crashing", () => {
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    variants.forEach((variant) => {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    });
  });

  it("renders all sizes without crashing", () => {
    const sizes = ["sm", "md", "lg"] as const;
    sizes.forEach((size) => {
      const { unmount } = render(<Button size={size}>{size}</Button>);
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    });
  });
});
