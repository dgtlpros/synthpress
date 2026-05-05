import NextLink from "next/link";
import { cn } from "@/lib/cn";

export interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  popular?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
  className?: string;
}

export function PricingCard({
  name,
  price,
  period = "/mo",
  description,
  features,
  popular = false,
  ctaLabel = "Get Started",
  ctaHref = "#",
  className,
}: PricingCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[var(--sp-radius-xl)] border p-8",
        popular
          ? "border-brand-purple bg-surface shadow-[var(--sp-shadow-lg)] scale-105"
          : "border-border bg-surface shadow-[var(--sp-shadow-sm)]",
        className,
      )}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-[var(--sp-radius-full)] bg-gradient-accent px-3 py-1 text-xs font-semibold text-white">
          Most Popular
        </span>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">{name}</h3>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>

      <div className="mb-6">
        <span className="text-4xl font-bold text-foreground">{price}</span>
        <span className="text-sm text-muted">{period}</span>
      </div>

      <ul className="mb-8 flex-1 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
            <span className="mt-0.5 text-success">&#10003;</span>
            {feature}
          </li>
        ))}
      </ul>

      <NextLink
        href={ctaHref}
        className={cn(
          "inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] text-sm font-medium transition-all",
          popular
            ? "bg-gradient-accent text-white shadow-md hover:brightness-110"
            : "border border-border bg-surface text-foreground hover:bg-surface-hover",
        )}
      >
        {ctaLabel}
      </NextLink>
    </div>
  );
}
