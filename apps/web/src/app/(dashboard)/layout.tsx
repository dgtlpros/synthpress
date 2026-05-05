import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance } from "@/services/token-service";
import { TokenBadge } from "@/components/atoms/TokenBadge";
import {
  DashboardSidebar,
  type SidebarNavItem,
} from "@/components/molecules/DashboardSidebar";
import { MobileNavConnector } from "@/connectors/MobileNavConnector";

export const dynamic = "force-dynamic";

const NAV_ITEMS: SidebarNavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Projects", href: "/projects" },
  { label: "Articles", href: "/articles" },
  { label: "Account", href: "/account" },
  { label: "Billing", href: "/account/billing" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const balance = await getBalance(user.id, createAdminClient());

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar
        navItems={NAV_ITEMS}
        email={user.email}
        className="hidden min-h-screen lg:flex"
      />
      <main className="flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNavConnector
              navItems={NAV_ITEMS}
              email={user.email}
              className="lg:hidden"
            />
            <Link href="/" className="flex items-center lg:hidden" aria-label="Home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/synthpress-logo-icon.svg"
                alt="SynthPress"
                className="h-8 w-auto"
              />
            </Link>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/account/billing"
              aria-label="View billing and synth tokens"
              className="cursor-pointer"
            >
              <TokenBadge
                balance={balance}
                variant={balance <= 50 ? "warning" : "brand"}
                size="lg"
              />
            </Link>
            <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          </div>
        </header>
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
