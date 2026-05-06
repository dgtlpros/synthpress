import NextLink from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentPlan } from "@/services/billing-service";
import { getBalance } from "@/services/token-service";
import { Avatar } from "@/components/atoms/Avatar";
import {
  PlanBadge,
  type SubscriptionStatus,
} from "@/components/atoms/PlanBadge";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/atoms/Card";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

const KNOWN_STATUSES: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "canceled",
  "unpaid",
  "paused",
  "free",
];

function normalizeStatus(status: string): SubscriptionStatus {
  return (KNOWN_STATUSES as string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "active";
}

function getInitials(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  if (name && name.trim().length > 0) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

const numberFormatter = new Intl.NumberFormat("en-US");

export default async function AccountPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const [current, balance] = await Promise.all([
    getCurrentPlan(user.id, admin),
    getBalance(user.id, admin),
  ]);

  const fullName = user.user_metadata?.full_name as string | undefined;
  const planName = current?.plan.name ?? "Free";
  const status = current
    ? normalizeStatus(current.subscription.status)
    : "free";
  const memberSince = new Date(user.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const memberSinceShort = new Date(user.created_at).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "short",
    },
  );

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar
              src={user.user_metadata?.avatar_url as string | undefined}
              fallback={getInitials(fullName, user.email)}
              size="lg"
              className="ring-2 ring-border"
            />
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {fullName?.trim() || user.email}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{user.email}</span>
                <span aria-hidden="true">·</span>
                <PlanBadge planName={planName} status={status} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <TokenBadge balance={balance} variant="brand" size="lg" />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Synth tokens</CardDescription>
            <CardTitle className="text-3xl">
              {numberFormatter.format(balance)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">
              {current
                ? `Includes ${numberFormatter.format(current.plan.monthly_tokens)} granted each cycle. Tokens roll over.`
                : "Top up or subscribe to add more."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className="text-3xl">{planName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">
              {current
                ? `$${(current.plan.monthly_price_cents / 100).toFixed(0)} / month · ${status === "active" ? "Active" : status.replace("_", " ")}`
                : "No subscription yet — choose a plan to unlock more tokens."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Member since</CardDescription>
            <CardTitle className="text-3xl">{memberSinceShort}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">{memberSince}</p>
          </CardContent>
        </Card>
      </div>

      {/* Workspaces + billing */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NextLink
          href="/teams"
          className="group flex items-center justify-between rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)] transition-all hover:bg-surface-hover hover:shadow-[var(--sp-shadow-md)]"
        >
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Teams &amp; projects
            </h2>
            <p className="mt-1 text-sm text-muted">
              Organize people in teams, scope work in projects, connect blogs
              per project.
            </p>
          </div>
          <span className="text-sm text-muted transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </NextLink>

        <NextLink
          href="/account/billing"
          className="group flex items-center justify-between rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)] transition-all hover:bg-surface-hover hover:shadow-[var(--sp-shadow-md)]"
        >
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Billing &amp; tokens
            </h2>
            <p className="mt-1 text-sm text-muted">
              Manage your plan, top up tokens, view invoices.
            </p>
          </div>
          <span className="text-sm text-muted transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </NextLink>

        <NextLink
          href={current ? "/account/billing" : "/pricing"}
          className="group flex items-center justify-between rounded-[var(--sp-radius-xl)] border border-brand-purple/40 bg-gradient-to-br from-brand-purple/5 to-brand-blue/5 p-6 shadow-[var(--sp-shadow-sm)] transition-all hover:shadow-[var(--sp-shadow-md)] sm:col-span-2 lg:col-span-1"
        >
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {current ? "Buy more tokens" : "Choose a plan"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {current
                ? "One-time top-ups never expire."
                : "Get monthly synth tokens at any tier."}
            </p>
          </div>
          <span className="text-sm text-muted transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </NextLink>
      </div>

      {/* Profile details */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            The information your account is associated with.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                Email
              </dt>
              <dd className="mt-1 text-sm text-foreground">{user.email}</dd>
            </div>
            {fullName?.trim() && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                  Name
                </dt>
                <dd className="mt-1 text-sm text-foreground">{fullName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                Account ID
              </dt>
              <dd className="mt-1 font-mono text-xs text-muted">{user.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                Account created
              </dt>
              <dd className="mt-1 text-sm text-foreground">{memberSince}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Session */}
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Sign out of your account on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
