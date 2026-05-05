import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 border-r border-border bg-surface lg:block">
        <div className="flex h-16 items-center border-b border-border px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SynthPress" className="h-8 w-auto" />
        </div>
        <nav className="p-4 space-y-1">
          <Link href="/dashboard" className="flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-hover transition-colors">
            Dashboard
          </Link>
          <Link href="/projects" className="flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors">
            Projects
          </Link>
          <Link href="/articles" className="flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors">
            Articles
          </Link>
          <Link href="/account" className="flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors">
            Account
          </Link>
        </nav>
      </aside>
      <main className="flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border px-6">
          <div />
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{user.email}</span>
          </div>
        </header>
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
