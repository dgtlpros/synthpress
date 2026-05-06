import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "@/components/atoms/Badge";

export type InvoiceStatusValue =
  | "paid"
  | "open"
  | "void"
  | "uncollectible"
  | "draft"
  | "unknown";

export interface InvoiceStatusBadgeProps {
  status: InvoiceStatusValue;
  className?: string;
}

const statusConfig: Record<
  InvoiceStatusValue,
  { variant: BadgeVariant; label: string }
> = {
  paid: { variant: "success", label: "Paid" },
  open: { variant: "warning", label: "Open" },
  void: { variant: "default", label: "Void" },
  uncollectible: { variant: "error", label: "Uncollectible" },
  draft: { variant: "default", label: "Draft" },
  unknown: { variant: "default", label: "Unknown" },
};

export function InvoiceStatusBadge({
  status,
  className,
}: InvoiceStatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={cn(className)}>
      {config.label}
    </Badge>
  );
}
