"use client";

import { useState, useTransition } from "react";
import { createBillingPortal } from "@/actions/billing";

export interface UseBillingActionsResult {
  openPortal: () => void;
  isOpeningPortal: boolean;
  portalError: string | null;
}

export function useBillingActions(): UseBillingActionsResult {
  const [isPending, startTransition] = useTransition();
  const [portalError, setPortalError] = useState<string | null>(null);

  function openPortal() {
    setPortalError(null);
    startTransition(async () => {
      const result = await createBillingPortal();
      if (result.error || !result.url) {
        setPortalError(result.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = result.url;
    });
  }

  return {
    openPortal,
    isOpeningPortal: isPending,
    portalError,
  };
}
