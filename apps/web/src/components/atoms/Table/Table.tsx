import {
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
}

/**
 * Wraps a `<table>` in an overflow-friendly container so the consumer can keep
 * the table itself unconstrained while still being responsive on narrow
 * viewports.
 */
export function Table({
  containerClassName,
  className,
  children,
  ...props
}: TableProps) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-[var(--sp-radius-xl)] border border-border bg-surface shadow-[var(--sp-shadow-sm)]",
        containerClassName,
      )}
    >
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-surface-hover/40 text-xs font-semibold uppercase tracking-wide text-muted",
        className,
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("divide-y divide-border", className)} {...props}>
      {children}
    </tbody>
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
}

export function TableRow({
  interactive,
  className,
  children,
  ...props
}: TableRowProps) {
  return (
    <tr
      className={cn(
        interactive &&
          "cursor-pointer transition-colors hover:bg-surface-hover/60",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 text-left font-semibold text-muted", className)}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-3 align-middle text-foreground", className)}
      {...props}
    >
      {children}
    </td>
  );
}
