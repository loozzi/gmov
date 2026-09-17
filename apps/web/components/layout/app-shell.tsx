"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

/** Routes that render their own full-screen chrome-less surface. The profile
 * chooser is one: it hides the header/footer so picking a profile is the only
 * way forward (Netflix-style "Who's watching?"). */
const IMMERSIVE_ROUTES = new Set(["/profiles"]);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (IMMERSIVE_ROUTES.has(pathname)) return <>{children}</>;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
