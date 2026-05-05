import { NextResponse, type NextRequest } from "next/server";
import { getStripe, verifyWebhook } from "@/services/stripe-service";
import { handleWebhookEvent } from "@/services/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = await verifyWebhook({ rawBody, signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid signature";
    return NextResponse.json({ error: `Webhook signature failed: ${message}` }, { status: 400 });
  }

  try {
    await handleWebhookEvent(event, {
      retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
      retrieveCharge: (id) => getStripe().charges.retrieve(id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "handler failure";
    return NextResponse.json({ error: `Webhook handler failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
