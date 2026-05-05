"use client";

import { useCheckout, type CheckoutTarget } from "@/hooks/useCheckout";
import { CheckoutEmbed } from "@/components/organisms/CheckoutEmbed";
import { Spinner } from "@/components/atoms/Spinner";

export interface CheckoutConnectorProps {
  target: CheckoutTarget;
}

export function CheckoutConnector({ target }: CheckoutConnectorProps) {
  const { clientSecret, isLoading, error } = useCheckout(target);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16" data-testid="checkout-loading">
        <Spinner size="lg" />
      </div>
    );
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
