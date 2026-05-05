"use client";

import { useBillingActions } from "@/hooks/useBillingActions";
import { Button } from "@/components/atoms/Button";

export interface BillingActionsConnectorProps {
  variant?: "primary" | "secondary";
  label?: string;
  className?: string;
}

export function BillingActionsConnector({
  variant = "secondary",
  label = "Manage subscription",
  className,
}: BillingActionsConnectorProps) {
  const { openPortal, isOpeningPortal, portalError } = useBillingActions();

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        onClick={openPortal}
        loading={isOpeningPortal}
      >
        {label}
      </Button>
      {portalError && (
        <p className="mt-2 text-xs text-error" role="alert">
          {portalError}
        </p>
      )}
    </div>
  );
}
