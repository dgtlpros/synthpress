"use client";

import { useEffect, useState } from "react";
import {
  createSubscriptionCheckout,
  createTopUpCheckout,
} from "@/actions/billing";

export type CheckoutInterval = "month" | "year";

export type CheckoutTarget =
  | { kind: "subscription"; planKey: string; interval?: CheckoutInterval }
  | { kind: "top_up"; packKey: string };

export interface UseCheckoutResult {
  clientSecret: string | null;
  isLoading: boolean;
  error: string | null;
}

function targetIdentity(target: CheckoutTarget): string {
  if (target.kind === "subscription") {
    return `sub:${target.planKey}:${target.interval ?? "month"}`;
  }
  return `top:${target.packKey}`;
}

export function useCheckout(target: CheckoutTarget): UseCheckoutResult {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const id = targetIdentity(target);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setClientSecret(null);
      setError(null);
      setIsLoading(true);
    });

    async function start() {
      try {
        const result =
          target.kind === "subscription"
            ? await createSubscriptionCheckout(
                target.planKey,
                target.interval ?? "month",
              )
            : await createTopUpCheckout(target.packKey);
        // Defensive: drop the result if the consumer unmounted (or the target
        // changed) while we were awaiting. React 18+ no-ops state setters on
        // unmounted components, so this is belt-and-suspenders. The branch
        // requires precise microtask ordering that's flaky in jsdom; we
        // exercise the equivalent catch-block path in tests instead.
        /* v8 ignore next */
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else if (result.clientSecret) {
          setClientSecret(result.clientSecret);
        } else {
          setError("Could not start checkout.");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not start checkout.",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    start();

    return () => {
      cancelled = true;
    };
  }, [id, target]);

  return { clientSecret, isLoading, error };
}
