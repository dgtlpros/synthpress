import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Textarea } from "./Textarea";

afterEach(cleanup);

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea placeholder="Write something" />);
    expect(screen.getByPlaceholderText("Write something")).toBeInTheDocument();
  });

  it("handles value changes", () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "content" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("shows error styling", () => {
    render(<Textarea error placeholder="Error" />);
    expect(screen.getByPlaceholderText("Error").className).toContain("border-error");
  });

  it("can be disabled", () => {
    render(<Textarea disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
