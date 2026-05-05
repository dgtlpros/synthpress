import NextLink from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { retrieveCheckoutSession } from "@/services/stripe-service";

export const dynamic = "force-dynamic";

interface ReturnPageProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function CheckoutReturnPage({ searchParams }: ReturnPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { session_id: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/account/billing");
  }

  let status: "complete" | "open" | "expired" | "unknown" = "unknown";
  try {
    const session = await retrieveCheckoutSession(sessionId);
    if (session.status === "complete") status = "complete";
    else if (session.status === "open") status = "open";
    else if (session.status === "expired") status = "expired";
  } catch {
    status = "unknown";
  }

  const heading = status === "complete" ? "Payment received" : "Checkout in progress";
  const message =
    status === "complete"
      ? "Your synth tokens have been credited to your account. It can take a few seconds for the balance to refresh."
      : status === "open"
        ? "Your checkout session is still open. You can return to the previous page to finish payment."
        : status === "expired"
          ? "This checkout session expired. Please start a new one from the pricing page or your billing settings."
          : "We couldn't confirm this checkout session. Check your billing page in a moment for the latest status.";

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-12 text-center">
      <h1 className="text-3xl font-bold text-foreground">{heading}</h1>
      <p className="text-base text-muted">{message}</p>
      <div className="flex justify-center gap-3 pt-4">
        <NextLink
          href="/account/billing"
          className="inline-flex h-11 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent px-5 text-sm font-medium text-white shadow-md transition-all hover:brightness-110"
        >
          Go to billing
        </NextLink>
        <NextLink
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-5 text-sm font-medium text-foreground hover:bg-surface-hover"
        >
          Back to dashboard
        </NextLink>
      </div>
    </div>
  );
}
