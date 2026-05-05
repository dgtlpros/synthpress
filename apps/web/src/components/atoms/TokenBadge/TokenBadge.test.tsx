import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { TokenBadge } from "./TokenBadge";

afterEach(cleanup);

describe("TokenBadge", () => {
  it("formats large balances with commas and pluralizes", () => {
    render(<TokenBadge balance={1500} />);
    expect(screen.getByText("1,500 tokens")).toBeInTheDocument();
  });

  it("singularizes for a balance of one", () => {
    render(<TokenBadge balance={1} />);
    expect(screen.getByText("1 token")).toBeInTheDocument();
  });

  it("compact mode hides the unit", () => {
    render(<TokenBadge balance={250} compact />);
    expect(screen.getByText("250")).toBeInTheDocument();
    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
  });

  it("renders all variants without crashing", () => {
    for (const variant of ["neutral", "brand", "warning"] as const) {
      const { unmount } = render(<TokenBadge balance={100} variant={variant} />);
      expect(screen.getByText(/tokens/)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders all size variants", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = render(<TokenBadge balance={100} size={size} />);
      expect(screen.getByText(/tokens/)).toBeInTheDocument();
      unmount();
    }
  });
});
