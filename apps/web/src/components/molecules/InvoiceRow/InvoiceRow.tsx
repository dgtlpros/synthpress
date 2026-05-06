import { cn } from "@/lib/cn";
import {
  InvoiceStatusBadge,
  type InvoiceStatusValue,
} from "@/components/atoms/InvoiceStatusBadge";

export interface InvoiceRowProps {
  /** Stripe invoice id; we slice it for fallback labels when no number is set. */
  id: string;
  /** Stripe-assigned invoice number, e.g. "INV-001". */
  number: string | null;
  status: InvoiceStatusValue;
  amountCents: number;
  /** ISO 4217 currency code from Stripe (lowercase). */
  currency: string;
  /** Unix-seconds timestamp from Stripe `invoice.created`. */
  createdAt: number;
  /** Unix-seconds timestamp range; null when Stripe didn't expose one. */
  periodStart: number | null;
  periodEnd: number | null;
  /** Direct PDF download URL; null for very early/draft invoices. */
  pdfUrl: string | null;
  /** Stripe-hosted invoice page URL; null for very early/draft invoices. */
  hostedUrl: string | null;
  className?: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const periodFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatTimestamp(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp * 1000));
}

function formatPeriod(start: number | null, end: number | null): string | null {
  if (!start || !end) return null;
  return `${periodFormatter.format(new Date(start * 1000))} – ${dateFormatter.format(
    new Date(end * 1000),
  )}`;
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const linkClass =
  "inline-flex h-8 items-center justify-center rounded-[var(--sp-radius-md)] border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors cursor-pointer";

export function InvoiceRow({
  id,
  number,
  status,
  amountCents,
  currency,
  createdAt,
  periodStart,
  periodEnd,
  pdfUrl,
  hostedUrl,
  className,
}: InvoiceRowProps) {
  const label = number ?? `Invoice ${id.slice(-8)}`;
  const periodLabel = formatPeriod(periodStart, periodEnd);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted">{formatTimestamp(createdAt)}</span>
        </div>
        {periodLabel && <p className="text-xs text-muted">{periodLabel}</p>}
      </div>

      <div className="flex flex-shrink-0 items-center gap-3">
        <InvoiceStatusBadge status={status} />
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatAmount(amountCents, currency)}
        </span>
        {pdfUrl && (
          <a
            href={pdfUrl}
            className={linkClass}
            rel="noopener noreferrer"
            // `download` requests the browser save the file rather than
            // navigate; Stripe serves these as `application/pdf`.
            download
          >
            Download
          </a>
        )}
        {hostedUrl && (
          <a
            href={hostedUrl}
            className={linkClass}
            target="_blank"
            rel="noopener noreferrer"
          >
            View
          </a>
        )}
      </div>
    </li>
  );
}
