import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

afterEach(cleanup);

describe("ProgressBar", () => {
  it("renders with role=progressbar and the right aria values", () => {
    render(<ProgressBar value={42} label="Article generation progress" />);
    const bar = screen.getByRole("progressbar", {
      name: /article generation progress/i,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("falls back to a generic 'Progress' label", () => {
    render(<ProgressBar value={10} />);
    expect(
      screen.getByRole("progressbar", { name: "Progress" }),
    ).toBeInTheDocument();
  });

  it("clamps values above 100", () => {
    render(<ProgressBar value={150} label="x" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });

  it("clamps values below 0", () => {
    render(<ProgressBar value={-25} label="x" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("draws a 0% wide fill when value is 0", () => {
    render(<ProgressBar value={0} label="x" />);
    const fill = screen.getByRole("progressbar")
      .firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("inflates very small percentages to 4% so the bar stays visible", () => {
    render(<ProgressBar value={2} label="x" />);
    const fill = screen.getByRole("progressbar")
      .firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("4%");
    // aria-value still reflects the true percentage
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
  });

  it("uses the literal width for normal values", () => {
    render(<ProgressBar value={75} label="x" />);
    const fill = screen.getByRole("progressbar")
      .firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("75%");
  });

  it("applies the variant fill class", () => {
    render(<ProgressBar value={50} variant="success" label="x" />);
    const fill = screen.getByRole("progressbar")
      .firstElementChild as HTMLElement;
    expect(fill.className).toContain("bg-success");
  });

  it("applies the size class to the track", () => {
    render(<ProgressBar value={50} size="lg" label="x" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("h-2");
  });

  it("merges custom className onto the track", () => {
    render(<ProgressBar value={50} label="x" className="custom-track" />);
    expect(screen.getByRole("progressbar").className).toContain("custom-track");
  });
});
