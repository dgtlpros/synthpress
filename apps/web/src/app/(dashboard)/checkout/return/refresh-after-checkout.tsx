"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export interface RefreshAfterCheckoutProps {
  /**
   * Delay (in milliseconds) for a follow-up refresh after the initial one.
   *
   * The Stripe webhook that grants tokens / finalizes a subscription often
   * arrives a beat *after* the user is redirected back to the return page.
   * One immediate refresh covers the fast case (webhook already landed); the
   * follow-up refresh covers the slow case so the dashboard navbar's token
   * balance never stays stale for long.
   *
   * Pass `0` to disable the follow-up.
   * @default 1500
   */
  followUpDelayMs?: number;
}

/**
 * Forces the entire route — including parent layouts — to re-fetch its server
 * components after a successful checkout.
 *
 * The dashboard layout reads `getBalance()` and passes it to the navbar; that
 * value is fetched once when the layout segment hydrates. After a subscribe
 * or top-up, we MUST call `router.refresh()` so the layout (and therefore
 * the navbar's token badge) re-renders with the new balance. This component
 * is the single place that responsibility lives — drop it on any page the
 * user lands on after a successful purchase.
 */
export function RefreshAfterCheckout({
  followUpDelayMs = 1500,
}: RefreshAfterCheckoutProps = {}) {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    if (followUpDelayMs <= 0) return;
    const id = setTimeout(() => router.refresh(), followUpDelayMs);
    return () => clearTimeout(id);
  }, [router, followUpDelayMs]);

  return null;
}
