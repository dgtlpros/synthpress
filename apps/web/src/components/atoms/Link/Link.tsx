import { type AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  default: "text-brand-blue hover:text-brand-indigo transition-colors",
  muted: "text-muted hover:text-foreground transition-colors",
  nav: "text-foreground hover:text-brand-blue transition-colors font-medium",
} as const;

export type LinkVariant = keyof typeof variantStyles;

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: LinkVariant;
}

export function Link({ variant = "default", className, children, ...props }: LinkProps) {
  return (
    <a className={cn("text-sm", variantStyles[variant], className)} {...props}>
      {children}
    </a>
  );
}
