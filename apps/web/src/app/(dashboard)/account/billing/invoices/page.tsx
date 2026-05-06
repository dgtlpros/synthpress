import { Suspense } from "react";
import NextLink from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCustomerInvoices } from "@/services/stripe-service";
import { InvoiceList } from "@/components/organisms/InvoiceList";
import { InvoiceListSkeleton } from "@/components/atoms/InvoiceListSkeleton";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <NextLink
          href="/account/billing"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to billing
        </NextLink>
        <h1 className="mt-2 text-2xl font-bold text-foreground">
          Billing history
        </h1>
        <p className="mt-1 text-sm text-muted">
          Every charge generates a Stripe-hosted invoice with a downloadable
          PDF.
        </p>
      </div>

      {/* The shell renders immediately. The list streams in once the live
       * `stripe.invoices.list` call resolves — typically 80–200ms. */}
      <Suspense fallback={<InvoiceListSkeleton />}>
        <InvoiceListLoader userId={user.id} />
      </Suspense>
    </div>
  );
}

async function InvoiceListLoader({ userId }: { userId: string }) {
  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!customer?.stripe_customer_id) {
    return <InvoiceList invoices={[]} />;
  }

  const invoices = await getCustomerInvoices(customer.stripe_customer_id);

  return (
    <InvoiceList
      invoices={invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        amountCents:
          invoice.amountPaid > 0 ? invoice.amountPaid : invoice.amountDue,
        currency: invoice.currency,
        createdAt: invoice.createdAt,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        pdfUrl: invoice.pdfUrl,
        hostedUrl: invoice.hostedUrl,
      }))}
      footer={
        invoices.length > 0 ? (
          <span>
            Showing your most recent {invoices.length}{" "}
            {invoices.length === 1 ? "invoice" : "invoices"}. Older invoices are
            available in the Stripe Customer Portal via{" "}
            <NextLink className="underline" href="/account/billing">
              Manage subscription
            </NextLink>
            .
          </span>
        ) : null
      }
    />
  );
}
