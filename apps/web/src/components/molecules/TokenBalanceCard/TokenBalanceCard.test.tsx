import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { TokenBalanceCard } from "./TokenBalanceCard";

afterEach(cleanup);

describe("TokenBalanceCard", () => {
  it("renders a healthy balance and monthly allowance", () => {
    render(<TokenBalanceCard balance={5400} monthlyAllowance={5000} />);
    expect(screen.getByText("5,400")).toBeInTheDocument();
    expect(screen.getByText(/Includes 5,000 tokens granted each billing cycle/)).toBeInTheDocument();
  });

  it("uses warning variant on a low balance", () => {
    render(<TokenBalanceCard balance={10} />);
    expect(screen.getByText(/Running low/)).toBeInTheDocument();
  });

  it("shows out-of-tokens message at zero with no allowance", () => {
    render(<TokenBalanceCard balance={0} />);
    expect(screen.getByText(/Out of tokens/)).toBeInTheDocument();
  });

  it("shows the rollover blurb when balance is healthy and no allowance", () => {
    render(<TokenBalanceCard balance={500} />);
    expect(screen.getByText(/Tokens never expire/)).toBeInTheDocument();
  });

  it("renders provided actions", () => {
    render(
      <TokenBalanceCard balance={100} actions={<button>Top up</button>} />,
    );
    expect(screen.getByRole("button", { name: "Top up" })).toBeInTheDocument();
  });

  it("respects a custom low-balance threshold", () => {
    render(<TokenBalanceCard balance={500} lowBalanceThreshold={1000} />);
    expect(screen.getByText(/Running low/)).toBeInTheDocument();
  });
});
