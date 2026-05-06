import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { Navbar } from "@/components/molecules/Navbar";
import { Footer } from "@/components/organisms/Footer";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar user={null} />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Create your account
            </h1>
            <p className="mt-1 text-sm text-muted">
              No password needed — we&apos;ll send you a magic link
            </p>
          </div>
          <SignupForm />
          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-brand-blue hover:text-brand-indigo transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
