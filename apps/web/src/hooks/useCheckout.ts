"use client";

import { useEffect, useState } from "react";
import { createSubscriptionCheckout, createTopUpCheckout } from "@/actions/billing";

export type CheckoutTarget =
  | { kind: "subscription"; planKey: string }
  | { kind: "top_up"; packKey: string };

export interface UseCheckoutResult {
  clientSecret: string | null;
  isLoading: boolean;
  error: string | null;
}

function targetIdentity(target: CheckoutTarget): string {
  return target.kind === "subscription" ? `sub:${target.planKey}` : `top:${target.packKey}`;
}

export function useCheckout(target: CheckoutTarget): UseCheckoutResult {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const id = targetIdentity(target);

  useEffect(() => {
    let cancelled = false;
    setClientSecret(null);
    setError(null);
    setIsLoading(true);

    async function start() {
      try {
        const result =
          target.kind === "subscription"
            ? await createSubscriptionCheckout(target.planKey)
            : await createTopUpCheckout(target.packKey);
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
        setError(err instanceof Error ? err.message : "Could not start checkout.");
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
