import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SynthPress" className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a magic link</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-muted">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="font-medium text-brand-blue hover:text-brand-indigo transition-colors">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
