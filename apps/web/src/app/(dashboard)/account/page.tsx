import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Account</h1>
        <p className="mt-1 text-sm text-muted">Manage your account settings.</p>
      </div>

      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)]">
        <h2 className="text-lg font-semibold text-foreground">Profile</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted">Email</label>
            <p className="mt-1 text-sm text-foreground">{user.email}</p>
          </div>
          {user.user_metadata?.full_name && (
            <div>
              <label className="block text-sm font-medium text-muted">Name</label>
              <p className="mt-1 text-sm text-foreground">{user.user_metadata.full_name}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-muted">Account created</label>
            <p className="mt-1 text-sm text-foreground">
              {new Date(user.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)]">
        <h2 className="text-lg font-semibold text-foreground">Session</h2>
        <p className="mt-2 text-sm text-muted">
          Sign out of your account on this device.
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
