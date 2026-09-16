"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ProfilePreviews } from "@/components/movies/profile-previews";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfilePage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để xem trang cá nhân.
        </p>
        <Button asChild>
          <Link href="/login?next=/me">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-brand text-2xl font-bold text-brand-foreground">
          {user.display_name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{user.display_name}</h1>
          <p className="text-sm text-muted-foreground">
            @{user.username} · {user.email}
          </p>
        </div>
      </div>
      <ProfilePreviews />
      <Button
        variant="secondary"
        onClick={() => {
          void logout();
        }}
      >
        <LogOut /> Đăng xuất
      </Button>
    </section>
  );
}
