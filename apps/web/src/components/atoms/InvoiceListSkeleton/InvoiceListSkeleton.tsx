import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/atoms/Skeleton";

export interface InvoiceListSkeletonProps {
  /** Number of placeholder rows. Defaults to 4 — matches the average density. */
  rows?: number;
  className?: string;
}

/**
 * Suspense fallback shaped like the real InvoiceList. Used while the live
 * Stripe `invoices.list` call resolves on /account/billing/invoices.
 */
export function InvoiceListSkeleton({
  rows = 4,
  className,
}: InvoiceListSkeletonProps) {
  return (
    <div
      data-testid="invoice-list-skeleton"
      className={cn(
        "overflow-hidden rounded-[var(--sp-radius-xl)] border border-border bg-surface shadow-[var(--sp-shadow-sm)]",
        className,
      )}
    >
      <div className="border-b border-border bg-surface-hover/40 px-6 py-4">
        <Skeleton className="h-5 w-32" />
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-4 px-6 py-4"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton variant="pill" className="h-6 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-24" />
          </li>
        ))}
      </ul>
    </div>
  );
}
