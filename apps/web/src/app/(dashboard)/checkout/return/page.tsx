import NextLink from "next/link";
import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retrieveCheckoutSession } from "@/services/stripe-service";
import { getBalance } from "@/services/token-service";
import { CheckoutSuccessHero } from "@/components/molecules/CheckoutSuccessHero";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import { PriceTag } from "@/components/atoms/PriceTag";

export const dynamic = "force-dynamic";

interface ReturnPageProps {
  searchParams: Promise<{ session_id?: string }>;
}

type SessionStatus = "complete" | "open" | "expired" | "unknown";

interface SubscriptionDetails {
  kind: "subscription";
  planName: string;
  planDescription: string | null;
  interval: "month" | "year";
  monthlyTokens: number | null;
  amountTotal: number | null;
}

interface TopUpDetails {
  kind: "top_up";
  packName: string;
  packDescription: string | null;
  tokens: number | null;
  amountTotal: number | null;
}

type CompletedDetails = SubscriptionDetails | TopUpDetails | null;

export default async function CheckoutReturnPage({
  searchParams,
}: ReturnPageProps) {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) {
    redirect("/login");
  }

  const { session_id: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/account/billing");
  }

  let status: SessionStatus = "unknown";
  let session: Stripe.Checkout.Session | null = null;
  try {
    session = await retrieveCheckoutSession(sessionId);
    if (session.status === "complete") status = "complete";
    else if (session.status === "open") status = "open";
    else if (session.status === "expired") status = "expired";
  } catch {
    status = "unknown";
  }

  const admin = createAdminClient();
  const details: CompletedDetails =
    status === "complete" && session ? await loadDetails(session, admin) : null;

  const balance =
    status === "complete" ? await getBalance(user.id, admin) : null;
  const receiptEmail = session?.customer_details?.email ?? user.email ?? null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-10 py-10 sm:py-14">
      <CheckoutHeroForStatus status={status} details={details} />

      {status === "complete" && details && (
        <ReceiptCard details={details} balance={balance} />
      )}

      {status === "complete" && !details && (
        <FallbackCompleteCard balance={balance} />
      )}

      <CtaRow status={status} details={details} />

      {status === "complete" && receiptEmail && (
        <p className="text-center text-xs text-muted">
          A receipt was sent to{" "}
          <span className="font-medium text-foreground">{receiptEmail}</span> by
          Stripe.
        </p>
      )}
    </div>
  );
}

function CheckoutHeroForStatus({
  status,
  details,
}: {
  status: SessionStatus;
  details: CompletedDetails;
}) {
  if (status === "complete" && details?.kind === "subscription") {
    const cadence = details.interval === "year" ? "annual" : "monthly";
    return (
      <CheckoutSuccessHero
        variant="success"
        eyebrow="Subscription active"
        title={
          <>
            Welcome to{" "}
            <span className="text-gradient-accent">{details.planName}</span>
          </>
        }
        description={`Your ${cadence} subscription is live and your synth tokens are ready to use.`}
      />
    );
  }

  if (status === "complete" && details?.kind === "top_up") {
    const tokens = details.tokens ?? 0;
    const formatted = new Intl.NumberFormat("en-US").format(tokens);
    return (
      <CheckoutSuccessHero
        variant="success"
        eyebrow="Top-up complete"
        title={
          tokens > 0 ? (
            <>
              <span className="text-gradient-accent">{formatted}</span> synth
              tokens added
            </>
          ) : (
            "Top-up complete"
          )
        }
        description="They're already in your balance and they never expire."
      />
    );
  }

  if (status === "complete") {
    return (
      <CheckoutSuccessHero
        variant="success"
        eyebrow="Payment received"
        title="You're all set"
        description="Your purchase went through. Your balance and plan will refresh in a moment."
      />
    );
  }

  if (status === "open") {
    return (
      <CheckoutSuccessHero
        variant="pending"
        eyebrow="Hang tight"
        title="Finishing your checkout"
        description="Your checkout session is still open. You can return to the previous page to finish payment."
      />
    );
  }

  if (status === "expired") {
    return (
      <CheckoutSuccessHero
        variant="error"
        eyebrow="Checkout expired"
        title="Let's try that again"
        description="This checkout session expired. Start a new one from pricing or your billing settings."
      />
    );
  }

  return (
    <CheckoutSuccessHero
      variant="pending"
      eyebrow="Almost there"
      title="Still confirming your purchase"
      description="We couldn't confirm this checkout session yet. Check your billing page in a moment for the latest status."
    />
  );
}

function ReceiptCard({
  details,
  balance,
}: {
  details: SubscriptionDetails | TopUpDetails;
  balance: number | null;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--sp-radius-xl)] border border-border bg-surface shadow-[var(--sp-shadow-sm)]">
      <header className="border-b border-border bg-surface-hover/40 px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">Order summary</h2>
        <p className="text-sm text-muted">
          Reference your billing page anytime to view all transactions.
        </p>
      </header>
      <div className="space-y-5 px-6 py-5">
        {details.kind === "subscription" ? (
          <SubscriptionReceiptRows details={details} />
        ) : (
          <TopUpReceiptRows details={details} />
        )}

        {balance !== null && (
          <>
            <hr className="border-border" />
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Current balance
                </div>
                <div className="mt-1 text-sm text-foreground">
                  Synth tokens available right now.
                </div>
              </div>
              <TokenBadge balance={balance} variant="brand" size="lg" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SubscriptionReceiptRows({
  details,
}: {
  details: SubscriptionDetails;
}) {
  const cadenceLabel =
    details.interval === "year" ? "Billed annually" : "Billed monthly";
  const periodSuffix = details.interval === "year" ? "/yr" : "/mo";
  return (
    <>
      <ReceiptRow
        label="Plan"
        title={details.planName}
        subtitle={details.planDescription ?? cadenceLabel}
        right={
          details.amountTotal !== null ? (
            <PriceTag
              cents={details.amountTotal}
              period={periodSuffix}
              size="md"
            />
          ) : null
        }
      />
      {details.monthlyTokens !== null && (
        <ReceiptRow
          label="Tokens added"
          title={
            details.interval === "year"
              ? `${formatNumber(details.monthlyTokens * 12)} tokens`
              : `${formatNumber(details.monthlyTokens)} tokens`
          }
          subtitle={
            details.interval === "year"
              ? "12 months of tokens, granted up front."
              : "Granted at the start of each billing cycle."
          }
        />
      )}
    </>
  );
}

function TopUpReceiptRows({ details }: { details: TopUpDetails }) {
  return (
    <>
      <ReceiptRow
        label="Pack"
        title={details.packName}
        subtitle={details.packDescription ?? "One-time purchase"}
        right={
          details.amountTotal !== null ? (
            <PriceTag cents={details.amountTotal} size="md" />
          ) : null
        }
      />
      {details.tokens !== null && (
        <ReceiptRow
          label="Tokens added"
          title={`${formatNumber(details.tokens)} tokens`}
          subtitle="Tokens roll over and never expire."
        />
      )}
    </>
  );
}

function ReceiptRow({
  label,
  title,
  subtitle,
  right,
}: {
  label: string;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

function FallbackCompleteCard({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current balance</CardTitle>
        <CardDescription>
          Updated as soon as Stripe confirms your purchase.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(balance)}
        </div>
        <TokenBadge balance={balance} variant="brand" size="lg" />
      </CardContent>
    </Card>
  );
}

function CtaRow({
  status,
  details,
}: {
  status: SessionStatus;
  details: CompletedDetails;
}) {
  const primaryClass =
    "inline-flex h-11 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent px-5 text-sm font-medium text-white shadow-md transition-all hover:brightness-110 cursor-pointer";
  const secondaryClass =
    "inline-flex h-11 items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-5 text-sm font-medium text-foreground hover:bg-surface-hover transition-colors cursor-pointer";

  if (status === "expired" || status === "unknown") {
    return (
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        <NextLink href="/account/billing" className={secondaryClass}>
          View billing
        </NextLink>
        <NextLink
          href={details?.kind === "top_up" ? "/account/billing" : "/pricing"}
          className={primaryClass}
        >
          Try again
        </NextLink>
      </div>
    );
  }

  if (status === "open") {
    return (
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        <NextLink href="/account/billing" className={secondaryClass}>
          View billing
        </NextLink>
        <NextLink href="/dashboard" className={secondaryClass}>
          Back to dashboard
        </NextLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
      <NextLink href="/account/billing" className={secondaryClass}>
        View billing
      </NextLink>
      <NextLink href="/dashboard" className={primaryClass}>
        Go to dashboard
        <span aria-hidden="true">→</span>
      </NextLink>
    </div>
  );
}

async function loadDetails(
  session: Stripe.Checkout.Session,
  admin: ReturnType<typeof createAdminClient>,
): Promise<CompletedDetails> {
  const metadata = session.metadata ?? {};
  const checkoutKind = metadata.checkout_kind;
  const amountTotal = session.amount_total ?? null;

  if (
    checkoutKind === "subscription" &&
    typeof metadata.plan_key === "string"
  ) {
    const interval = metadata.interval === "year" ? "year" : "month";
    const { data: plan } = await admin
      .from("plans")
      .select("name, description, monthly_tokens")
      .eq("key", metadata.plan_key)
      .maybeSingle();
    if (!plan) return null;
    return {
      kind: "subscription",
      planName: plan.name,
      planDescription: plan.description ?? null,
      interval,
      monthlyTokens: plan.monthly_tokens ?? null,
      amountTotal,
    };
  }

  if (checkoutKind === "top_up" && typeof metadata.pack_key === "string") {
    const tokensFromMetadata =
      typeof metadata.tokens === "string" && metadata.tokens.length > 0
        ? Number.parseInt(metadata.tokens, 10)
        : null;
    const { data: pack } = await admin
      .from("token_packs")
      .select("name, description, tokens")
      .eq("key", metadata.pack_key)
      .maybeSingle();
    if (!pack) return null;
    return {
      kind: "top_up",
      packName: pack.name,
      packDescription: pack.description ?? null,
      tokens:
        Number.isFinite(tokensFromMetadata) && tokensFromMetadata !== null
          ? tokensFromMetadata
          : (pack.tokens ?? null),
      amountTotal,
    };
  }

  return null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
