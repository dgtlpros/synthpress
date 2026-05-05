import { cn } from "@/lib/cn";
import { PricingCard } from "@/components/molecules/PricingCard";

const tiers = [
  {
    name: "Starter",
    price: "$29",
    description: "For solo creators",
    features: [
      "1 WordPress site",
      "1,000 synth tokens / month",
      "AI article generation",
      "Auto-publishing",
      "Email support",
    ],
    ctaHref: "/pricing",
  },
  {
    name: "Pro",
    price: "$79",
    description: "For growing networks",
    features: [
      "5 WordPress sites",
      "5,000 synth tokens / month",
      "AI article generation",
      "Auto-publishing",
      "MSN syndication",
      "Priority support",
    ],
    popular: true,
    ctaHref: "/pricing",
  },
  {
    name: "Scale",
    price: "$199",
    description: "For agencies & networks",
    features: [
      "20 WordPress sites",
      "20,000 synth tokens / month",
      "AI article generation",
      "Auto-publishing",
      "MSN syndication",
      "Dedicated support",
      "Custom AI prompts",
    ],
    ctaHref: "/pricing",
  },
];

export interface PricingProps {
  className?: string;
}

export function Pricing({ className }: PricingProps) {
  return (
    <section id="pricing" className={cn("px-6 py-24", className)}>
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-lg text-muted">
            Start with 100 free synth tokens. Subscribe for monthly tokens, top up at any time, and never lose what you don&apos;t use.
          </p>
        </div>

        <div className="mt-16 grid items-start gap-8 sm:grid-cols-3">
          {tiers.map((tier) => (
            <PricingCard key={tier.name} {...tier} />
          ))}
        </div>
      </div>
    </section>
  );
}
