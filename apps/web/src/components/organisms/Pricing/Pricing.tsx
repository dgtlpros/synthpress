import { PricingCard } from "@/components/molecules/PricingCard";

const tiers = [
  {
    name: "Starter",
    price: "$29",
    description: "For solo creators",
    features: ["1 WordPress site", "30 articles/month", "AI article generation", "Auto-publishing", "Email support"],
  },
  {
    name: "Pro",
    price: "$79",
    description: "For growing networks",
    features: ["5 WordPress sites", "150 articles/month", "AI article generation", "Auto-publishing", "MSN syndication", "Priority support"],
    popular: true,
  },
  {
    name: "Scale",
    price: "$199",
    description: "For agencies & networks",
    features: ["20 WordPress sites", "Unlimited articles", "AI article generation", "Auto-publishing", "MSN syndication", "Dedicated support", "Custom AI prompts"],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-lg text-muted">Start free, scale as you grow. No hidden fees.</p>
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
