"use client";

import { useMemo } from "react";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { cn } from "@/lib/cn";
import { getStripeBrowser } from "@/lib/stripe-browser";

export interface CheckoutEmbedProps {
  clientSecret: string;
  className?: string;
}

export function CheckoutEmbed({ clientSecret, className }: CheckoutEmbedProps) {
  const stripePromise = useMemo(() => getStripeBrowser(), []);
  const options = useMemo(() => ({ clientSecret }), [clientSecret]);

  return (
    <div className={cn("w-full", className)}>
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
