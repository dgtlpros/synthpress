import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { CheckoutSuccessHero } from "./CheckoutSuccessHero";

afterEach(cleanup);

describe("CheckoutSuccessHero", () => {
  it("renders a celebratory hero with confetti by default", () => {
    render(
      <CheckoutSuccessHero
        eyebrow="Payment successful"
        title="Welcome to Pro"
        description="Your tokens are loaded."
      />,
    );

    const hero = screen.getByTestId("checkout-success-hero");
    expect(hero).toHaveAttribute("data-variant", "success");
    expect(screen.getByText("Payment successful")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Welcome to Pro" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Your tokens are loaded.")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-success-confetti")).toBeInTheDocument();
  });

  it("hides confetti for the pending variant", () => {
    render(
      <CheckoutSuccessHero
        variant="pending"
        title="Just a moment"
        description="We're confirming your payment with Stripe."
      />,
    );

    expect(screen.getByTestId("checkout-success-hero")).toHaveAttribute(
      "data-variant",
      "pending",
    );
    expect(
      screen.queryByTestId("checkout-success-confetti"),
    ).not.toBeInTheDocument();
  });

  it("uses an error visual for the error variant", () => {
    render(
      <CheckoutSuccessHero
        variant="error"
        eyebrow="Something went wrong"
        title="Checkout expired"
        description="Please try again."
      />,
    );

    expect(screen.getByTestId("checkout-success-hero")).toHaveAttribute(
      "data-variant",
      "error",
    );
    expect(
      screen.queryByTestId("checkout-success-confetti"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("does not render an eyebrow when none is provided", () => {
    render(<CheckoutSuccessHero title="Welcome" description="You're in." />);

    expect(
      screen.queryByTestId("checkout-success-eyebrow"),
    ).not.toBeInTheDocument();
  });

  it("forwards a custom className", () => {
    render(
      <CheckoutSuccessHero
        title="Welcome"
        description="."
        className="custom-class"
      />,
    );

    expect(screen.getByTestId("checkout-success-hero")).toHaveClass(
      "custom-class",
    );
  });
});
