import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/hooks/useBillingActions", () => ({
  useBillingActions: vi.fn(),
}));

import { useBillingActions } from "@/hooks/useBillingActions";
import { BillingActionsConnector } from "./BillingActionsConnector";

const mockedUse = vi.mocked(useBillingActions);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BillingActionsConnector", () => {
  it("renders the manage subscription button by default", () => {
    mockedUse.mockReturnValue({
      openPortal: vi.fn(),
      isOpeningPortal: false,
      portalError: null,
    });
    render(<BillingActionsConnector />);
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
  });

  it("supports custom labels and variants", () => {
    mockedUse.mockReturnValue({
      openPortal: vi.fn(),
      isOpeningPortal: false,
      portalError: null,
    });
    render(<BillingActionsConnector label="Update card" variant="primary" />);
    expect(screen.getByRole("button", { name: "Update card" })).toBeInTheDocument();
  });

  it("invokes the openPortal callback on click", () => {
    const openPortal = vi.fn();
    mockedUse.mockReturnValue({ openPortal, isOpeningPortal: false, portalError: null });
    render(<BillingActionsConnector />);

    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
    expect(openPortal).toHaveBeenCalledTimes(1);
  });

  it("renders a loading state when opening", () => {
    mockedUse.mockReturnValue({
      openPortal: vi.fn(),
      isOpeningPortal: true,
      portalError: null,
    });
    render(<BillingActionsConnector />);
    expect(screen.getByRole("button", { name: "Manage subscription" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders an error message when portal fails", () => {
    mockedUse.mockReturnValue({
      openPortal: vi.fn(),
      isOpeningPortal: false,
      portalError: "boom",
    });
    render(<BillingActionsConnector />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
