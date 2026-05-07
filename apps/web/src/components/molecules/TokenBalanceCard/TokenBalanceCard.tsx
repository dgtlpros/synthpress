import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/atoms/Card";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import { LOW_BALANCE_THRESHOLD } from "@/lib/token-badge-variant";

const formatter = new Intl.NumberFormat("en-US");

export interface TokenBalanceCardProps {
  balance: number;
  monthlyAllowance?: number;
  lowBalanceThreshold?: number;
  actions?: ReactNode;
  className?: string;
}

export function TokenBalanceCard({
  balance,
  monthlyAllowance,
  lowBalanceThreshold = LOW_BALANCE_THRESHOLD,
  actions,
  className,
}: TokenBalanceCardProps) {
  const isLow = balance <= lowBalanceThreshold;
  const allowance = monthlyAllowance ?? 0;
  const hasRecurringAllowance = allowance > 0;
  // Local override of the shared resolver so a custom lowBalanceThreshold
  // (used by tests / opinionated callers) still controls the warning swap.
  const variant = isLow ? "warning" : "lime";

  let helper: string;
  if (hasRecurringAllowance) {
    helper = `Includes ${formatter.format(allowance)} tokens granted each billing cycle. Unused tokens roll over.`;
  } else if (balance === 0) {
    helper =
      "Out of tokens. Purchase a top-up or subscribe to keep generating.";
  } else if (isLow) {
    helper =
      "Running low. Top up or subscribe to keep generating without interruption.";
  } else {
    helper = "Tokens never expire — they roll over month-to-month.";
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Synth tokens</CardTitle>
            <CardDescription>Used by AI generation features.</CardDescription>
          </div>
          <TokenBadge balance={balance} variant={variant} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className={cn(
            "text-4xl font-bold",
            variant === "lime"
              ? "text-gradient-lime-strong"
              : "text-foreground",
          )}
        >
          {formatter.format(balance)}
        </div>
        <p className="text-sm text-muted">{helper}</p>
      </CardContent>

      {actions && <CardFooter className="gap-3">{actions}</CardFooter>}
    </Card>
  );
}
