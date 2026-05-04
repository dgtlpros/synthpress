import { type HTMLAttributes, type ElementType } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  h1: "text-4xl font-bold tracking-tight",
  h2: "text-3xl font-semibold tracking-tight",
  h3: "text-2xl font-semibold",
  h4: "text-xl font-semibold",
  h5: "text-lg font-medium",
  h6: "text-base font-medium",
  body: "text-base",
  "body-sm": "text-sm",
  caption: "text-xs",
  overline: "text-xs font-semibold uppercase tracking-wider",
} as const;

const colorStyles = {
  default: "text-foreground",
  muted: "text-muted",
  brand: "text-gradient-brand",
  accent: "text-gradient-accent",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
} as const;

const defaultTags: Record<TextVariant, ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  body: "p",
  "body-sm": "p",
  caption: "span",
  overline: "span",
};

export type TextVariant = keyof typeof variantStyles;
export type TextColor = keyof typeof colorStyles;

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  color?: TextColor;
  as?: ElementType;
}

export function Text({
  variant = "body",
  color = "default",
  as,
  className,
  children,
  ...props
}: TextProps) {
  const Component = as || defaultTags[variant];

  return (
    <Component
      className={cn(variantStyles[variant], colorStyles[color], className)}
      {...props}
    >
      {children}
    </Component>
  );
}
