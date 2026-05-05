import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PriceTag } from "@/components/atoms/PriceTag";

const formatter = new Intl.NumberFormat("en-US");

export interface TopUpCardProps {
  name: string;
  description?: string;
  tokens: number;
  priceCents: number;
  highlighted?: boolean;
  cta: ReactNode;
  className?: string;
}

export function TopUpCard({
  name,
  description,
  tokens,
  priceCents,
  highlighted = false,
  cta,
  className,
}: TopUpCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--sp-radius-xl)] border bg-surface p-6",
        highlighted
          ? "border-brand-purple shadow-[var(--sp-shadow-md)]"
          : "border-border shadow-[var(--sp-shadow-sm)]",
        className,
      )}
    >
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">{name}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>

      <div className="mb-4">
        <div className="text-3xl font-bold text-foreground">{formatter.format(tokens)}</div>
        <p className="text-xs uppercase tracking-wide text-muted">synth tokens</p>
      </div>

      <div className="mb-6">
        <PriceTag cents={priceCents} size="md" />
      </div>

      <div className="mt-auto">{cta}</div>
    </div>
  );
}
