import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

afterEach(cleanup);

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Drafts" value={12} />);
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders an optional hint", () => {
    render(<StatCard label="Posts" value={42} hint="last 30 days" />);
    expect(screen.getByText("last 30 days")).toBeInTheDocument();
  });

  it("renders an optional icon", () => {
    render(
      <StatCard label="Active" value={3} icon={<span data-testid="icon" />} />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("applies tone styles", () => {
    render(<StatCard label="Failed" value={1} tone="error" />);
    expect(screen.getByText("1").className).toMatch(/text-error/);
  });

  it("forwards className to the root", () => {
    render(<StatCard label="x" value={1} className="my-card" />);
    expect(screen.getByText("x").closest("div.my-card")).not.toBeNull();
  });
});
