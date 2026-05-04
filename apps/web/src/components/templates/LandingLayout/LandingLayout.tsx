import { type ReactNode } from "react";
import { Navbar } from "@/components/molecules/Navbar";

export function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
