"use client";

import { useState } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/atoms/Button";
import { ConfirmModal } from "@/components/atoms/ConfirmModal";

export function SignOutButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await signOut();
  }

  return (
    <>
      <Button variant="danger" size="md" onClick={() => setOpen(true)}>
        Sign Out
      </Button>
      <ConfirmModal
        open={open}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
        title="Sign Out"
        message="Are you sure you want to sign out of your account?"
        confirmLabel="Sign Out"
        variant="danger"
        loading={loading}
      />
    </>
  );
}
