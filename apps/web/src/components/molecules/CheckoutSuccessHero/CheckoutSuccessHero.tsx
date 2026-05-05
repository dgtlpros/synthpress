import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

const variantConfig = {
  success: {
    orbClass: "bg-gradient-accent",
    ringClass: "bg-gradient-glow",
    iconColor: "white",
    eyebrowClass: "text-brand-purple",
    showConfetti: true,
  },
  pending: {
    orbClass: "bg-surface border border-border",
    ringClass: "bg-foreground/10",
    iconColor: "var(--foreground)",
    eyebrowClass: "text-muted",
    showConfetti: false,
  },
  error: {
    orbClass: "bg-error",
    ringClass: "bg-error/40",
    iconColor: "white",
    eyebrowClass: "text-error",
    showConfetti: false,
  },
} as const;

export type CheckoutSuccessHeroVariant = keyof typeof variantConfig;

export interface CheckoutSuccessHeroProps {
  variant?: CheckoutSuccessHeroVariant;
  eyebrow?: string;
  title: ReactNode;
  description: ReactNode;
  className?: string;
}

export function CheckoutSuccessHero({
  variant = "success",
  eyebrow,
  title,
  description,
  className,
}: CheckoutSuccessHeroProps) {
  const config = variantConfig[variant];

  return (
    <section
      data-testid="checkout-success-hero"
      data-variant={variant}
      className={cn("relative isolate text-center", className)}
    >
      {config.showConfetti && <ConfettiBurst />}

      <div className="relative mx-auto flex h-32 w-32 items-center justify-center">
        {variant !== "pending" && (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "sp-anim-pulse-ring absolute inset-0 rounded-full",
                config.ringClass,
              )}
              style={{ animationDelay: "0.2s" }}
            />
            <span
              aria-hidden="true"
              className={cn(
                "sp-anim-pulse-ring absolute inset-0 rounded-full",
                config.ringClass,
              )}
              style={{ animationDelay: "1.1s" }}
            />
          </>
        )}

        <div
          className={cn(
            "relative flex h-24 w-24 items-center justify-center rounded-full shadow-[var(--sp-shadow-lg)]",
            config.orbClass,
          )}
        >
          <HeroIcon variant={variant} color={config.iconColor} />
        </div>
      </div>

      <div className="relative mt-8 space-y-3">
        {eyebrow && (
          <p
            data-testid="checkout-success-eyebrow"
            className={cn(
              "sp-anim-rise-in text-xs font-semibold uppercase tracking-[0.18em]",
              config.eyebrowClass,
            )}
            style={{ animationDelay: "0.1s" }}
          >
            {eyebrow}
          </p>
        )}
        <h1
          className="sp-anim-rise-in text-3xl font-bold text-foreground sm:text-4xl"
          style={{ animationDelay: "0.2s" }}
        >
          {title}
        </h1>
        <p
          className="sp-anim-rise-in mx-auto max-w-xl text-base text-muted"
          style={{ animationDelay: "0.3s" }}
        >
          {description}
        </p>
      </div>
    </section>
  );
}

function HeroIcon({
  variant,
  color,
}: {
  variant: CheckoutSuccessHeroVariant;
  color: string;
}) {
  if (variant === "success") {
    return (
      <svg
        viewBox="0 0 50 50"
        className="h-14 w-14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M14 26 l8 8 l16 -16"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sp-anim-check-draw"
        />
      </svg>
    );
  }

  if (variant === "pending") {
    return (
      <svg
        viewBox="0 0 50 50"
        className="h-14 w-14 animate-spin"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="25"
          cy="25"
          r="18"
          stroke={color}
          strokeOpacity="0.2"
          strokeWidth="4"
        />
        <path
          d="M25 7 a18 18 0 0 1 18 18"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 50 50"
      className="h-14 w-14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M25 14 v14"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="25" cy="35" r="2.5" fill={color} />
    </svg>
  );
}

const confettiPieces: Array<{
  top: string;
  left: string;
  bg: string;
  size: number;
  rounded: string;
  rotate: string;
  translateX: string;
  translateY: string;
  delay: string;
  duration: string;
}> = [
  {
    top: "8%",
    left: "18%",
    bg: "var(--sp-purple)",
    size: 10,
    rounded: "9999px",
    rotate: "180deg",
    translateX: "-40px",
    translateY: "-30px",
    delay: "0s",
    duration: "2.4s",
  },
  {
    top: "12%",
    left: "78%",
    bg: "var(--sp-magenta)",
    size: 12,
    rounded: "2px",
    rotate: "220deg",
    translateX: "55px",
    translateY: "-20px",
    delay: "0.15s",
    duration: "2.2s",
  },
  {
    top: "30%",
    left: "8%",
    bg: "var(--sp-cyan)",
    size: 8,
    rounded: "9999px",
    rotate: "-160deg",
    translateX: "-65px",
    translateY: "10px",
    delay: "0.3s",
    duration: "2.6s",
  },
  {
    top: "32%",
    left: "90%",
    bg: "var(--sp-blue)",
    size: 9,
    rounded: "2px",
    rotate: "140deg",
    translateX: "65px",
    translateY: "20px",
    delay: "0.05s",
    duration: "2.3s",
  },
  {
    top: "6%",
    left: "48%",
    bg: "var(--sp-pink)",
    size: 7,
    rounded: "9999px",
    rotate: "-90deg",
    translateX: "-10px",
    translateY: "-50px",
    delay: "0.2s",
    duration: "2.5s",
  },
  {
    top: "58%",
    left: "20%",
    bg: "var(--sp-indigo)",
    size: 9,
    rounded: "2px",
    rotate: "-200deg",
    translateX: "-50px",
    translateY: "40px",
    delay: "0.4s",
    duration: "2.5s",
  },
  {
    top: "62%",
    left: "82%",
    bg: "var(--sp-purple)",
    size: 11,
    rounded: "9999px",
    rotate: "200deg",
    translateX: "55px",
    translateY: "45px",
    delay: "0.25s",
    duration: "2.4s",
  },
  {
    top: "20%",
    left: "62%",
    bg: "var(--sp-cyan)",
    size: 6,
    rounded: "9999px",
    rotate: "60deg",
    translateX: "30px",
    translateY: "-40px",
    delay: "0.5s",
    duration: "2.0s",
  },
  {
    top: "44%",
    left: "94%",
    bg: "var(--sp-magenta)",
    size: 8,
    rounded: "2px",
    rotate: "300deg",
    translateX: "70px",
    translateY: "5px",
    delay: "0.6s",
    duration: "2.3s",
  },
  {
    top: "44%",
    left: "4%",
    bg: "var(--sp-pink)",
    size: 8,
    rounded: "2px",
    rotate: "-300deg",
    translateX: "-70px",
    translateY: "-5px",
    delay: "0.45s",
    duration: "2.2s",
  },
];

function ConfettiBurst() {
  return (
    <div
      data-testid="checkout-success-confetti"
      aria-hidden="true"
      className="pointer-events-none absolute -inset-x-6 -inset-y-2 overflow-hidden"
    >
      {confettiPieces.map((piece, index) => {
        const style: CSSProperties & Record<string, string | number> = {
          top: piece.top,
          left: piece.left,
          width: piece.size,
          height: piece.size,
          backgroundColor: piece.bg,
          borderRadius: piece.rounded,
          "--sp-confetti-x": piece.translateX,
          "--sp-confetti-y": piece.translateY,
          "--sp-confetti-rotate": piece.rotate,
          animationDuration: piece.duration,
          animationDelay: piece.delay,
        };
        return (
          <span
            key={index}
            className="sp-anim-confetti absolute"
            style={style}
          />
        );
      })}
    </div>
  );
}
