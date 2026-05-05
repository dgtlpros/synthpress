import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/hooks/useBillingActions", () => ({
  useBillingActions: vi.fn(),
}));

import { useBillingActions } from "@/hooks/useBillingActions";
import { BillingActionsConnector } from "./BillingActionsConnector";

const mockedUse = vi.mocked(useBillingActions);

function defaultHookReturn() {
  return {
    openPortal: vi.fn(),
    isOpeningPortal: false,
    portalError: null,
    resume: vi.fn(),
    isResuming: false,
    resumeError: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BillingActionsConnector", () => {
  it("renders the manage subscription button by default", () => {
    mockedUse.mockReturnValue(defaultHookReturn());
    render(<BillingActionsConnector />);
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
  });

  it("renders the resume subscription button in resume mode", () => {
    mockedUse.mockReturnValue(defaultHookReturn());
    render(<BillingActionsConnector mode="resume" />);
    expect(screen.getByRole("button", { name: "Resume subscription" })).toBeInTheDocument();
  });

  it("supports custom labels and variants", () => {
    mockedUse.mockReturnValue(defaultHookReturn());
    render(<BillingActionsConnector label="Update card" variant="primary" />);
    expect(screen.getByRole("button", { name: "Update card" })).toBeInTheDocument();
  });

  it("invokes openPortal in manage mode", () => {
    const hook = defaultHookReturn();
    mockedUse.mockReturnValue(hook);
    render(<BillingActionsConnector />);

    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
    expect(hook.openPortal).toHaveBeenCalledTimes(1);
    expect(hook.resume).not.toHaveBeenCalled();
  });

  it("invokes resume in resume mode", () => {
    const hook = defaultHookReturn();
    mockedUse.mockReturnValue(hook);
    render(<BillingActionsConnector mode="resume" />);

    fireEvent.click(screen.getByRole("button", { name: "Resume subscription" }));
    expect(hook.resume).toHaveBeenCalledTimes(1);
    expect(hook.openPortal).not.toHaveBeenCalled();
  });

  it("renders a loading state when opening the portal", () => {
    mockedUse.mockReturnValue({ ...defaultHookReturn(), isOpeningPortal: true });
    render(<BillingActionsConnector />);
    expect(screen.getByRole("button", { name: "Manage subscription" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders a loading state when resuming", () => {
    mockedUse.mockReturnValue({ ...defaultHookReturn(), isResuming: true });
    render(<BillingActionsConnector mode="resume" />);
    expect(screen.getByRole("button", { name: "Resume subscription" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders the portal error message when manage fails", () => {
    mockedUse.mockReturnValue({ ...defaultHookReturn(), portalError: "portal boom" });
    render(<BillingActionsConnector />);
    expect(screen.getByRole("alert")).toHaveTextContent("portal boom");
  });

  it("renders the resume error message when resume fails", () => {
    mockedUse.mockReturnValue({ ...defaultHookReturn(), resumeError: "resume boom" });
    render(<BillingActionsConnector mode="resume" />);
    expect(screen.getByRole("alert")).toHaveTextContent("resume boom");
  });
});
