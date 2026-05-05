import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/hooks/useCheckout", () => ({
  useCheckout: vi.fn(),
}));

vi.mock("@/components/organisms/CheckoutEmbed", () => ({
  CheckoutEmbed: ({ clientSecret }: { clientSecret: string }) => (
    <div data-testid="embed" data-secret={clientSecret} />
  ),
}));

import { useCheckout } from "@/hooks/useCheckout";
import { CheckoutConnector } from "./CheckoutConnector";

const mockedUse = vi.mocked(useCheckout);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("CheckoutConnector", () => {
  it("renders a spinner while loading", () => {
    mockedUse.mockReturnValue({ clientSecret: null, isLoading: true, error: null });
    render(<CheckoutConnector target={{ kind: "subscription", planKey: "pro" }} />);
    expect(screen.getByTestId("checkout-loading")).toBeInTheDocument();
  });

  it("renders the error message when there is an error", () => {
    mockedUse.mockReturnValue({ clientSecret: null, isLoading: false, error: "boom" });
    render(<CheckoutConnector target={{ kind: "subscription", planKey: "pro" }} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders a fallback when clientSecret is missing without an error", () => {
    mockedUse.mockReturnValue({ clientSecret: null, isLoading: false, error: null });
    render(<CheckoutConnector target={{ kind: "subscription", planKey: "pro" }} />);
    expect(screen.getByText(/Could not initialize/)).toBeInTheDocument();
  });

  it("renders the embed when ready", () => {
    mockedUse.mockReturnValue({ clientSecret: "secret_x", isLoading: false, error: null });
    render(<CheckoutConnector target={{ kind: "top_up", packKey: "pack_500" }} />);
    expect(screen.getByTestId("embed")).toHaveAttribute("data-secret", "secret_x");
  });
});
