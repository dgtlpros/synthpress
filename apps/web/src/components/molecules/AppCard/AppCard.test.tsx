import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { AppCard } from "./AppCard";

afterEach(cleanup);

describe("AppCard", () => {
  it("renders as a link when href is set", () => {
    render(<AppCard title="Blog" description="WordPress" href="/blogs" />);
    const link = screen.getByRole("link", { name: /Blog/i });
    expect(link).toHaveAttribute("href", "/blogs");
  });

  it("renders as a static card when href is omitted", () => {
    render(<AppCard title="Soon" description="Not ready" disabled />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Soon")).toBeInTheDocument();
  });

  it("shows badge content", () => {
    render(<AppCard title="Blog" href="/b" badge={<span data-testid="badge">3</span>} />);
    expect(screen.getByTestId("badge")).toHaveTextContent("3");
  });

  it("renders icon slot", () => {
    render(<AppCard title="X" href="/x" icon={<span data-testid="ic">I</span>} />);
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });

  it("renders as a disabled div when href is set but disabled is true", () => {
    render(<AppCard title="Locked" href="/locked" disabled />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("renders as a static div with aria-disabled when no href and not disabled", () => {
    render(<AppCard title="NoHref" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("NoHref")).toBeInTheDocument();
  });
});
