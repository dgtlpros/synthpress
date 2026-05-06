import { redirect } from "next/navigation";
import NextLink from "next/link";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { CheckoutConnector } from "@/connectors/CheckoutConnector";
import type { CheckoutTarget } from "@/hooks/useCheckout";

export const dynamic = "force-dynamic";

interface CheckoutPageProps {
  searchParams: Promise<{ plan?: string; pack?: string; interval?: string }>;
}

export default async function CheckoutPage({
  searchParams,
}: CheckoutPageProps) {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();

  const params = await searchParams;
  const planKey = params.plan;
  const packKey = params.pack;
  const interval = params.interval === "year" ? "year" : "month";

  let target: CheckoutTarget | null = null;
  let title = "Checkout";
  let subtitle = "";

  if (planKey) {
    const { data: plan } = await supabase
      .from("plans")
      .select("name, description")
      .eq("key", planKey)
      .maybeSingle();
    if (!plan) {
      redirect("/pricing");
    }
    target = { kind: "subscription", planKey, interval };
    const cadence = interval === "year" ? "annually" : "monthly";
    title = `Subscribe to ${plan.name}`;
    subtitle = plan.description
      ? `${plan.description} · billed ${cadence}`
      : `Billed ${cadence}`;
  } else if (packKey) {
    const { data: pack } = await supabase
      .from("token_packs")
      .select("name, description")
      .eq("key", packKey)
      .maybeSingle();
    if (!pack) {
      redirect("/account/billing");
    }
    target = { kind: "top_up", packKey };
    title = `Buy ${pack.name}`;
    subtitle = pack.description ?? "";
  } else {
    redirect("/pricing");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <NextLink
          href={
            target!.kind === "subscription" ? "/pricing" : "/account/billing"
          }
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back
        </NextLink>
        <h1 className="mt-3 text-2xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>

      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)]">
        <CheckoutConnector target={target!} />
      </div>
    </div>
  );
}
