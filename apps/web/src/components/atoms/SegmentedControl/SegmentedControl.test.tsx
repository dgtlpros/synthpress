import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

const options = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual", badge: "Save 17%" },
] as const;

describe("SegmentedControl", () => {
  it("renders both options", () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="month"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /Monthly/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Annual/ })).toBeInTheDocument();
  });

  it("marks the active option with aria-selected", () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="year"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /Annual/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Monthly/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onChange with the selected value when clicked", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[...options]}
        value="month"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Annual/ }));
    expect(onChange).toHaveBeenCalledWith("year");
  });

  it("renders the optional badge text", () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="month"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Save 17%")).toBeInTheDocument();
  });

  it("uses the aria-label on the tablist when provided", () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="month"
        onChange={() => {}}
        ariaLabel="Billing interval"
      />,
    );
    expect(
      screen.getByRole("tablist", { name: "Billing interval" }),
    ).toBeInTheDocument();
  });
});
