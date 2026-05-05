import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/stripe-service", () => ({
  getStripe: vi.fn(),
  verifyWebhook: vi.fn(),
}));

vi.mock("@/services/billing-service", () => ({
  handleWebhookEvent: vi.fn(),
}));

import { getStripe, verifyWebhook } from "@/services/stripe-service";
import { handleWebhookEvent } from "@/services/billing-service";
import { POST } from "./route";

const mockedVerify = vi.mocked(verifyWebhook);
const mockedHandle = vi.mocked(handleWebhookEvent);
const mockedGetStripe = vi.mocked(getStripe);

function makeRequest(opts: { signature?: string; body?: string } = {}) {
  const headers = new Headers();
  if (opts.signature !== undefined) headers.set("stripe-signature", opts.signature);
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: opts.body ?? "raw-body",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing stripe-signature header" });
  });

  it("returns 400 when verification fails", async () => {
    mockedVerify.mockRejectedValue(new Error("bad sig"));

    const res = await POST(makeRequest({ signature: "t=1,v1=abc" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Webhook signature failed: bad sig/);
  });

  it("returns 400 when verification throws a non-Error", async () => {
    mockedVerify.mockRejectedValue("something");
    const res = await POST(makeRequest({ signature: "t=1,v1=abc" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid signature/);
  });

  it("dispatches verified events to the billing service and returns 200", async () => {
    const event = { id: "evt_1", type: "checkout.session.completed" };
    mockedVerify.mockResolvedValue(event as never);
    mockedHandle.mockResolvedValue(undefined);
    const subscriptionsRetrieve = vi.fn();
    mockedGetStripe.mockReturnValue({
      subscriptions: { retrieve: subscriptionsRetrieve },
    } as never);

    const res = await POST(makeRequest({ signature: "ok" }));

    expect(mockedVerify).toHaveBeenCalledWith({ rawBody: "raw-body", signature: "ok" });
    expect(mockedHandle).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ retrieveSubscription: expect.any(Function) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it("the retrieveSubscription helper calls stripe.subscriptions.retrieve", async () => {
    const event = { id: "evt_1", type: "customer.subscription.updated" };
    mockedVerify.mockResolvedValue(event as never);
    let captured: ((id: string) => Promise<unknown>) | undefined;
    mockedHandle.mockImplementation(async (_event, options) => {
      captured = options?.retrieveSubscription as never;
    });
    const subscriptionsRetrieve = vi.fn().mockResolvedValue({ id: "sub_1" });
    mockedGetStripe.mockReturnValue({
      subscriptions: { retrieve: subscriptionsRetrieve },
    } as never);

    await POST(makeRequest({ signature: "ok" }));

    expect(captured).toBeDefined();
    await captured!("sub_x");
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_x");
  });

  it("returns 500 when the handler throws", async () => {
    mockedVerify.mockResolvedValue({ id: "evt_2", type: "checkout.session.completed" } as never);
    mockedHandle.mockRejectedValue(new Error("db down"));
    mockedGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } } as never);

    const res = await POST(makeRequest({ signature: "ok" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/db down/);
  });

  it("returns 500 with generic message on non-Error rejection", async () => {
    mockedVerify.mockResolvedValue({ id: "evt_3", type: "x" } as never);
    mockedHandle.mockRejectedValue("oops");
    mockedGetStripe.mockReturnValue({ subscriptions: { retrieve: vi.fn() } } as never);

    const res = await POST(makeRequest({ signature: "ok" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/handler failure/);
  });
});
