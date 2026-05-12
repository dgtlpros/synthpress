import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchJobQueuedEvent, JOB_QUEUED_EVENT_NAME } from "./active-jobs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JOB_QUEUED_EVENT_NAME", () => {
  it("uses a namespaced, stable event name", () => {
    // Stable across versions — the global tray hook listens for this
    // exact string. Changing it would silently regress the snappy
    // "I just clicked Generate" UX.
    expect(JOB_QUEUED_EVENT_NAME).toBe("synthpress:active-jobs:queued");
  });
});

describe("dispatchJobQueuedEvent", () => {
  it("fires a CustomEvent on `window` with the right name + detail", () => {
    const listener = vi.fn();
    window.addEventListener(JOB_QUEUED_EVENT_NAME, listener);

    dispatchJobQueuedEvent({ jobId: "job-1", articleId: "art-1" });

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe(JOB_QUEUED_EVENT_NAME);
    expect(event.detail).toEqual({ jobId: "job-1", articleId: "art-1" });
    window.removeEventListener(JOB_QUEUED_EVENT_NAME, listener);
  });

  it("supports omitting articleId (some callers won't have one yet)", () => {
    const listener = vi.fn();
    window.addEventListener(JOB_QUEUED_EVENT_NAME, listener);

    dispatchJobQueuedEvent({ jobId: "job-2" });

    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ jobId: "job-2" });
    window.removeEventListener(JOB_QUEUED_EVENT_NAME, listener);
  });
});
