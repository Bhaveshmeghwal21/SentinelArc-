"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Client-side sign-out control for the dashboard sidebar.
 *
 * `signOut` from next-auth/react must run in a client component. Calling it
 * directly (rather than via the `useSession` hook) does not require a
 * SessionProvider, so this button can be dropped into the server-rendered
 * dashboard layout without wrapping the tree in a provider.
 */
export function SignOutButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </Button>
  );
}
