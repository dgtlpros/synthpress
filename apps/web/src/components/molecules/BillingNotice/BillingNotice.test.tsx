import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { BillingNotice } from "./BillingNotice";

afterEach(cleanup);

describe("BillingNotice", () => {
  it("renders with the default info variant when none is given", () => {
    render(<BillingNotice title="Heads up" />);
    const notice = screen.getByTestId("billing-notice");
    expect(notice).toHaveAttribute("data-variant", "info");
    expect(screen.getByText("Heads up")).toBeInTheDocument();
  });

  it("renders the title, description, and action together", () => {
    render(
      <BillingNotice
        variant="warning"
        title="Subscription is set to cancel"
        description="You'll keep access until June 5, 2026."
        action={<button>Resume</button>}
      />,
    );

    expect(screen.getByTestId("billing-notice")).toHaveAttribute("data-variant", "warning");
    expect(screen.getByText("Subscription is set to cancel")).toBeInTheDocument();
    expect(screen.getByText("You'll keep access until June 5, 2026.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("supports the danger variant", () => {
    render(<BillingNotice variant="danger" title="Payment failed" />);
    expect(screen.getByTestId("billing-notice")).toHaveAttribute("data-variant", "danger");
  });

  it("supports the success variant", () => {
    render(<BillingNotice variant="success" title="Subscription resumed" />);
    expect(screen.getByTestId("billing-notice")).toHaveAttribute("data-variant", "success");
  });

  it("renders without a description when none is provided", () => {
    render(<BillingNotice title="Just a heading" />);
    const notice = screen.getByTestId("billing-notice");
    expect(notice.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders a custom icon when provided", () => {
    render(
      <BillingNotice
        title="Custom"
        icon={<span data-testid="custom-icon">!</span>}
      />,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("forwards a custom className", () => {
    render(<BillingNotice title="X" className="custom" />);
    expect(screen.getByTestId("billing-notice")).toHaveClass("custom");
  });
});
