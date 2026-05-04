import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Toggle } from "./Toggle";

afterEach(cleanup);

describe("Toggle", () => {
  it("renders as a switch", () => {
    render(<Toggle />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("reflects checked state", () => {
    render(<Toggle checked />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
