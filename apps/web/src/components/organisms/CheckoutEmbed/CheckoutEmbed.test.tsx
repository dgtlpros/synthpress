import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({
    children,
    options,
    stripe,
  }: {
    children: React.ReactNode;
    options: { clientSecret: string };
    stripe: unknown;
  }) => (
    <div
      data-testid="ec-provider"
      data-client-secret={options.clientSecret}
      data-has-stripe={String(Boolean(stripe))}
    >
      {children}
    </div>
  ),
  EmbeddedCheckout: () => <div data-testid="ec-embed">[checkout]</div>,
}));

vi.mock("@/lib/stripe-browser", () => ({
  getStripeBrowser: vi.fn().mockReturnValue(Promise.resolve({})),
}));

import { CheckoutEmbed } from "./CheckoutEmbed";
import { getStripeBrowser } from "@/lib/stripe-browser";

const mockedGetStripe = vi.mocked(getStripeBrowser);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("CheckoutEmbed", () => {
  it("renders the Stripe Embedded Checkout provider with the client secret", () => {
    render(<CheckoutEmbed clientSecret="cs_test_secret" />);

    const provider = screen.getByTestId("ec-provider");
    expect(provider).toHaveAttribute("data-client-secret", "cs_test_secret");
    expect(provider).toHaveAttribute("data-has-stripe", "true");
    expect(screen.getByTestId("ec-embed")).toBeInTheDocument();
  });

  it("uses the memoized stripe promise from the browser singleton", () => {
    render(<CheckoutEmbed clientSecret="cs_a" />);
    expect(mockedGetStripe).toHaveBeenCalledTimes(1);
  });

  it("merges custom className on the wrapper", () => {
    const { container } = render(
      <CheckoutEmbed clientSecret="cs_b" className="custom-x" />,
    );
    expect(container.firstChild).toHaveClass("custom-x");
  });
});
