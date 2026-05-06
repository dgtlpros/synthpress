import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  InvoiceRow,
  type InvoiceRowProps,
} from "@/components/molecules/InvoiceRow";

export type InvoiceListItemView = Omit<InvoiceRowProps, "className">;

export interface InvoiceListProps {
  invoices: InvoiceListItemView[];
  /** Optional slot rendered after the rows (e.g. "View older invoices in Stripe"). */
  footer?: ReactNode;
  /** Optional title; defaults to "Billing history". */
  title?: string;
  /** Optional empty-state copy. */
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function InvoiceList({
  invoices,
  footer,
  title = "Billing history",
  emptyTitle = "No invoices yet",
  emptyDescription = "Invoices appear here once your subscription is charged. Top-up purchases also generate invoices.",
  className,
}: InvoiceListProps) {
  return (
    <section
      data-testid="invoice-list"
      className={cn(
        "overflow-hidden rounded-[var(--sp-radius-xl)] border border-border bg-surface shadow-[var(--sp-shadow-sm)]",
        className,
      )}
    >
      <header className="border-b border-border bg-surface-hover/40 px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted">
          Stripe issues a hosted PDF for each invoice — download or view in a
          new tab.
        </p>
      </header>

      {invoices.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="mt-1 text-xs text-muted">{emptyDescription}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {invoices.map((invoice) => (
            <InvoiceRow key={invoice.id} {...invoice} />
          ))}
        </ul>
      )}

      {footer && (
        <div className="border-t border-border bg-surface-hover/40 px-6 py-3 text-xs text-muted">
          {footer}
        </div>
      )}
    </section>
  );
}
