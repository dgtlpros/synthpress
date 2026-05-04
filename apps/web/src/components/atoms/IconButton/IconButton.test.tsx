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
});
