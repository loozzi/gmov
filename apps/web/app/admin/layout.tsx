"use client";

import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login?next=/admin/reports");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated || !user) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (user.role === "user") {
    notFound();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="size-6 text-brand" />
          Quản trị
        </h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/admin/reports"
            className="text-muted-foreground hover:text-foreground"
          >
            Báo cáo
          </Link>
        </nav>
      </div>
      {children}
    </section>
  );
}
