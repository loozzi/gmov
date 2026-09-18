"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { isProfileRequired } from "@/lib/errors";
import { useCurrentProfile } from "@/lib/profiles";

/** Signed in, but these routes are how you get a profile (or sign in), so they
 * must render before one is picked — the same set the chooser links to. */
const UNGATED_ROUTES = new Set([
  "/profiles",
  "/profiles/manage",
  "/login",
  "/register",
]);

/** Login does not select a profile (the backend answers 403 PROFILE_REQUIRED
 * for profile-scoped data), so an authenticated session without one is sent to
 * the chooser instead of rendering pages whose data can never load. */
export function ProfileGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const needed = isAuthenticated && !authLoading && !UNGATED_ROUTES.has(pathname);
  const current = useCurrentProfile({ enabled: needed });
  const blocked = needed && isProfileRequired(current.error);

  useEffect(() => {
    if (!blocked) return;
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/profiles?next=${encodeURIComponent(next)}`);
  }, [blocked, router]);

  if (!needed || blocked) {
    // Hold the page back until a profile exists: rendering it now would fire
    // profile-scoped queries that can only fail.
    return blocked ? (
      <GatePlaceholder />
    ) : (
      <>{children}</>
    );
  }
  if (current.isPending) return <GatePlaceholder />;
  return <>{children}</>;
}

function GatePlaceholder() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Skeleton className="h-8 w-44" />
    </div>
  );
}
