"use client";

import { useState, useTransition } from "react";
import { createBillingPortal, resumeSubscription } from "@/actions/billing";

export interface UseBillingActionsResult {
  openPortal: () => void;
  isOpeningPortal: boolean;
  portalError: string | null;
  resume: () => void;
  isResuming: boolean;
  resumeError: string | null;
}

export function useBillingActions(): UseBillingActionsResult {
  const [isOpeningPortal, startPortalTransition] = useTransition();
  const [portalError, setPortalError] = useState<string | null>(null);

  const [isResuming, startResumeTransition] = useTransition();
  const [resumeError, setResumeError] = useState<string | null>(null);

  function openPortal() {
    setPortalError(null);
    startPortalTransition(async () => {
      const result = await createBillingPortal();
      if (result.error || !result.url) {
        setPortalError(result.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = result.url;
    });
  }

  function resume() {
    setResumeError(null);
    startResumeTransition(async () => {
      const result = await resumeSubscription();
      if (!result.ok) {
        setResumeError(result.error ?? "Could not resume subscription.");
      }
    });
  }

  return {
    openPortal,
    isOpeningPortal,
    portalError,
    resume,
    isResuming,
    resumeError,
  };
}
