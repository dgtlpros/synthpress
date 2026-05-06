"use client";

import { useBillingActions } from "@/hooks/useBillingActions";
import { Button } from "@/components/atoms/Button";

export type BillingActionsMode = "manage" | "resume";

export interface BillingActionsConnectorProps {
  mode?: BillingActionsMode;
  variant?: "primary" | "secondary";
  label?: string;
  className?: string;
}

const defaultLabels: Record<BillingActionsMode, string> = {
  manage: "Manage subscription",
  resume: "Resume subscription",
};

export function BillingActionsConnector({
  mode = "manage",
  variant,
  label,
  className,
}: BillingActionsConnectorProps) {
  const {
    openPortal,
    isOpeningPortal,
    portalError,
    resume,
    isResuming,
    resumeError,
  } = useBillingActions();

  const buttonLabel = label ?? defaultLabels[mode];
  const buttonVariant =
    variant ?? (mode === "resume" ? "primary" : "secondary");
  const onClick = mode === "resume" ? resume : openPortal;
  const loading = mode === "resume" ? isResuming : isOpeningPortal;
  const error = mode === "resume" ? resumeError : portalError;

  return (
    <div className={className}>
      <Button
        type="button"
        variant={buttonVariant}
        onClick={onClick}
        loading={loading}
      >
        {buttonLabel}
      </Button>
      {error && (
        <p className="mt-2 text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
