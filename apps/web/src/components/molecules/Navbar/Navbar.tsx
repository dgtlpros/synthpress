import NextLink from "next/link";
import { cn } from "@/lib/cn";
import { Link } from "@/components/atoms/Link";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

export interface NavbarProps {
  className?: string;
  user?: { email: string } | null;
}

export function Navbar({ className, user }: NavbarProps) {
  return (
    <nav className={cn("sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md", className)}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <NextLink href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SynthPress" className="h-9 w-auto" />
        </NextLink>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="cursor-pointer text-sm font-medium text-foreground hover:text-brand-blue transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <NextLink
              href="/account"
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110"
            >
              Account
            </NextLink>
          ) : (
            <>
              <Link href="/login" variant="nav">
                Log In
              </Link>
              <NextLink
                href="/signup"
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110"
              >
                Sign Up
              </NextLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
