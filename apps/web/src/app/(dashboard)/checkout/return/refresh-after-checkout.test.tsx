import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { RefreshAfterCheckout } from "./refresh-after-checkout";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  cleanup();
});

describe("RefreshAfterCheckout", () => {
  it("calls router.refresh once on mount", () => {
    render(<RefreshAfterCheckout followUpDelayMs={0} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("calls router.refresh again after the follow-up delay", () => {
    vi.useFakeTimers();
    render(<RefreshAfterCheckout followUpDelayMs={1500} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("uses a default follow-up delay when none is provided", () => {
    vi.useFakeTimers();
    render(<RefreshAfterCheckout />);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a follow-up when delay is zero", () => {
    vi.useFakeTimers();
    render(<RefreshAfterCheckout followUpDelayMs={0} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears the follow-up timer on unmount so unmounted components don't refresh", () => {
    vi.useFakeTimers();
    const { unmount } = render(<RefreshAfterCheckout followUpDelayMs={1500} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders nothing", () => {
    const { container } = render(<RefreshAfterCheckout followUpDelayMs={0} />);
    expect(container.firstChild).toBeNull();
  });
});
