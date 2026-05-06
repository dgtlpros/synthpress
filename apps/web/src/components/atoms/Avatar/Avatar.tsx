import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const sizeStyles = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
} as const;

export type AvatarSize = keyof typeof sizeStyles;

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback: string;
  size?: AvatarSize;
}

export function Avatar({
  src,
  alt,
  fallback,
  size = "md",
  className,
  ...props
}: AvatarProps) {
  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--sp-radius-full)] bg-gradient-accent font-medium text-white",
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {src ? (
        // User-provided URLs; next/image remotePatterns would be broader than we want here.
        // eslint-disable-next-line @next/next/no-img-element -- external avatar URLs
        <img
          src={src}
          alt={alt || fallback}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-label={alt || fallback}>{fallback}</span>
      )}
    </div>
  );
}
