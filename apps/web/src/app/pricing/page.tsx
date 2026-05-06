import NextLink from "next/link";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";
import {
  PricingTableConnector,
  type PricingTablePlan,
} from "@/connectors/PricingTableConnector";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const supabase = await createClient();

  const [
    { data: plans },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    getAuthUserOncePerResponse(),
  ]);

  const tablePlans: PricingTablePlan[] = (plans ?? []).map((plan) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    monthlyPriceCents: plan.monthly_price_cents,
    annualPriceCents: plan.annual_price_cents ?? null,
    features: Array.isArray(plan.features)
      ? (plan.features as unknown[]).filter(
          (f): f is string => typeof f === "string",
        )
      : [],
    isPopular: plan.is_popular,
  }));

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Pricing built around credits
            </h1>
            <p className="mt-4 text-lg text-muted">
              Every plan includes monthly synth tokens that fuel AI generation.
              Need more in a given month? Top up at any time without changing
              tiers — tokens roll over.
            </p>
          </div>

          <div className="mt-16">
            <PricingTableConnector plans={tablePlans} authed={Boolean(user)} />
          </div>

          <div className="mt-16 rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 text-center shadow-[var(--sp-shadow-sm)]">
            <h2 className="text-xl font-semibold text-foreground">
              Need a one-time top-up?
            </h2>
            <p className="mt-2 text-sm text-muted">
              Buy synth token packs without changing your plan. They never
              expire.
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
