"use client";

import { useCheckout, type CheckoutTarget } from "@/hooks/useCheckout";
import { CheckoutEmbed } from "@/components/organisms/CheckoutEmbed";
import { Skeleton } from "@/components/atoms/Skeleton";

export interface CheckoutConnectorProps {
  target: CheckoutTarget;
}

export function CheckoutConnector({ target }: CheckoutConnectorProps) {
  const { clientSecret, isLoading, error } = useCheckout(target);

  if (isLoading) {
    return <CheckoutSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-[var(--sp-radius-lg)] border border-error/30 bg-error/5 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="rounded-[var(--sp-radius-lg)] border border-border bg-surface p-4 text-sm text-muted">
        Could not initialize checkout.
      </div>
    );
  }

  return <CheckoutEmbed clientSecret={clientSecret} />;
}

function CheckoutSkeleton() {
  return (
    <div
      data-testid="checkout-loading"
      className="flex flex-col gap-4"
      aria-label="Loading checkout"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="flex gap-3">
        <Skeleton className="h-12 flex-1" />
        <Skeleton className="h-12 w-32" />
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="mt-2 h-11 w-full" variant="pill" />
    </div>
  );
}
