import NextLink from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";
import { PricingCard } from "@/components/molecules/PricingCard";

export const dynamic = "force-dynamic";

const formatter = new Intl.NumberFormat("en-US");

export default async function PricingPage() {
  const supabase = await createClient();

  const [{ data: plans }, { data: { user } }] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.auth.getUser(),
  ]);

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Pricing built around credits
            </h1>
            <p className="mt-4 text-lg text-muted">
              Every plan includes monthly synth tokens that fuel AI generation. Need more in a
              given month? Top up at any time without changing tiers — tokens roll over.
            </p>
          </div>

          <div className="mt-16 grid items-start gap-8 sm:grid-cols-3">
            {plans?.map((plan) => {
              const features = Array.isArray(plan.features)
                ? (plan.features as unknown[]).filter((f): f is string => typeof f === "string")
                : [];

              return (
                <PricingCard
                  key={plan.key}
                  name={plan.name}
                  price={`$${formatter.format(Math.floor(plan.monthly_price_cents / 100))}`}
                  description={plan.description}
                  features={features}
                  popular={plan.is_popular}
                  ctaLabel={user ? "Subscribe" : "Get Started"}
                  ctaHref={user ? `/checkout?plan=${plan.key}` : `/signup?next=/checkout?plan=${plan.key}`}
                />
              );
            })}
          </div>

          <div className="mt-16 rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 text-center shadow-[var(--sp-shadow-sm)]">
            <h2 className="text-xl font-semibold text-foreground">Need a one-time top-up?</h2>
            <p className="mt-2 text-sm text-muted">
              Buy synth token packs without changing your plan. They never expire.
            </p>
            <NextLink
              href={user ? "/account/billing" : "/signup"}
              className="mt-6 inline-flex h-11 cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-6 text-sm font-medium text-foreground transition-all hover:bg-surface-hover"
            >
              {user ? "Buy a token pack" : "Sign up to get started"}
            </NextLink>
          </div>
        </div>
      </section>
      <Footer />
    </LandingLayout>
  );
}
