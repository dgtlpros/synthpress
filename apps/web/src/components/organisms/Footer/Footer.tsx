import { Link } from "@/components/atoms/Link";
import { cn } from "@/lib/cn";

const footerLinks = {
  Product: [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/pricing" },
    { label: "How It Works", href: "/#how-it-works" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ],
};

export interface FooterProps {
  className?: string;
}

export function Footer({ className }: FooterProps) {
  return (
    <footer className={cn("border-t border-border px-6 py-16", className)}>
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 sm:grid-cols-4">
          <div>
            <picture>
              <source media="(min-width: 768px)" srcSet="/synthpress-full-logo.svg" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/synthpress-logo-icon.svg" alt="SynthPress" className="mb-4 h-14 w-auto" />
            </picture>
            <p className="text-sm text-muted leading-relaxed">
              AI-powered content generation and publishing for WordPress networks.
            </p>
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="mb-4 text-sm font-semibold text-foreground">{category}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} variant="muted">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-border pt-8 text-center">
          <p className="text-xs text-muted">&copy; 2026 SynthPress. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
