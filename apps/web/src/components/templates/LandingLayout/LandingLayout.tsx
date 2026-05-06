import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Navbar } from "@/components/molecules/Navbar";

export interface LandingLayoutProps {
  children: ReactNode;
  className?: string;
  user?: { email: string } | null;
}

export function LandingLayout({
  children,
  className,
  user,
}: LandingLayoutProps) {
  return (
    <div className={cn("flex min-h-screen flex-col bg-background", className)}>
      <Navbar user={user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
