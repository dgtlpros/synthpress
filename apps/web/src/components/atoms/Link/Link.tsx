import NextLink from "next/link";
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
  href: string;
}

export function Link({ variant = "default", className, href, children, ...props }: LinkProps) {
  const isExternal = href.startsWith("http") || href.startsWith("//");
  const isAnchor = href.startsWith("#");

  if (isExternal || isAnchor) {
    return (
      <a
        href={href}
        className={cn("cursor-pointer text-sm", variantStyles[variant], className)}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <NextLink
      href={href}
      className={cn("cursor-pointer text-sm", variantStyles[variant], className)}
      {...props}
    >
      {children}
    </NextLink>
  );
}
