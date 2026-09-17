"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  KeyRound,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileFormDialog } from "@/components/profile/profile-form-dialog";
import {
  ProfilePinDialog,
  pinErrorMessage,
} from "@/components/profile/profile-pin-dialog";
import { ProfileSetPinDialog } from "@/components/profile/profile-set-pin-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { ApiError, toVietnameseMessage } from "@/lib/errors";
import {
  useDeleteProfile,
  useProfiles,
  type ProfileListItem,
} from "@/lib/profiles";
import { useResetPreferences } from "@/lib/recommendations";

type PinMode = "set" | "clear";

interface PinTarget {
  profile: ProfileListItem;
  mode: PinMode;
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "DEFAULT_PROFILE")
      return "Không thể xoá profile mặc định.";
    if (error.code === "PROFILE_NOT_FOUND") return "Không tìm thấy profile.";
  }
  return toVietnameseMessage(error);
}

export default function ManageProfilesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading, isError, error } = useProfiles();
  const deleteProfile = useDeleteProfile();
  const resetPreferences = useResetPreferences();

  const [editProfile, setEditProfile] = useState<ProfileListItem | null>(null);
  const [pinTarget, setPinTarget] = useState<PinTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileListItem | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (item: ProfileListItem) => {
    if (item.has_pin) {
      setDeleteError(null);
      setDeleteTarget(item);
      return;
    }
    if (
      !window.confirm(
        `Xoá profile "${item.name}"? Toàn bộ dữ liệu của profile này sẽ bị xoá vĩnh viễn.`,
      )
    ) {
      return;
    }
    deleteProfile.mutate(
      { id: item.id },
      {
        onSuccess: () => toast(`Đã xoá profile ${item.name}.`, "success"),
        onError: (err: unknown) =>
          toast(deleteErrorMessage(err), "error"),
      },
    );
  };

  const submitDeletePin = (pin: string) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteProfile.mutate(
      { id: target.id, pin },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          setDeleteError(null);
          toast(`Đã xoá profile ${target.name}.`, "success");
        },
        onError: (err: unknown) => setDeleteError(pinErrorMessage(err)),
      },
    );
  };

  const handleRetune = (item: ProfileListItem) => {
    if (!item.is_current) {
      toast(
        `Hãy chuyển sang profile ${item.name} trước khi làm lại sở thích.`,
        "error",
      );
      return;
    }
    if (
      !window.confirm(
        `Làm lại sở thích cho profile "${item.name}"? Gu hiện tại của profile này sẽ được đặt lại.`,
      )
    ) {
      return;
    }
    resetPreferences.mutate(undefined, {
      onSuccess: () => router.push("/onboarding?again=1"),
      onError: (err: unknown) =>
        toast(toVietnameseMessage(err), "error"),
    });
  };

  if (authLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold">Quản lý profile</h1>
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để quản lý profile.
        </p>
        <Button asChild>
          <Link href="/login?next=/profiles/manage">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-4">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/profiles">
            <ChevronLeft /> Ai đang xem?
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Quản lý profile</h1>
        <p className="text-sm text-muted-foreground">
          Đổi tên, ảnh đại diện, đặt PIN hoặc xoá profile.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {toVietnameseMessage(error)}
        </p>
      ) : (
        <div className="space-y-3">
          {data.items.map((p) => (
            <div
              key={p.id}
              data-testid={`profile-row-${p.id}`}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
            >
              <ProfileAvatar avatar={p.avatar} className="size-14 text-3xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {p.is_current && (
                    <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 font-medium">
                      Đang xem
                    </span>
                  )}
                  {p.is_default && (
                    <span className="bg-muted rounded-full px-2 py-0.5">
                      Mặc định
                    </span>
                  )}
                  {p.has_pin && (
                    <span className="flex items-center gap-1">
                      <Lock className="size-3" /> Có PIN
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Đổi tên & avatar ${p.name}`}
                  onClick={() => setEditProfile(p)}
                >
                  <Pencil /> Đổi tên &amp; avatar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={
                    p.has_pin ? `Đổi PIN ${p.name}` : `Đặt PIN ${p.name}`
                  }
                  onClick={() => setPinTarget({ profile: p, mode: "set" })}
                >
                  <KeyRound /> {p.has_pin ? "Đổi PIN" : "Đặt PIN"}
                </Button>
                {p.has_pin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Xoá PIN ${p.name}`}
                    onClick={() => setPinTarget({ profile: p, mode: "clear" })}
                  >
                    Xoá PIN
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Làm lại sở thích ${p.name}`}
                  onClick={() => handleRetune(p)}
                  disabled={resetPreferences.isPending}
                >
                  <RefreshCw /> Làm lại sở thích
                </Button>
                {!p.is_default && (
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`Xoá profile ${p.name}`}
                    onClick={() => handleDelete(p)}
                    disabled={deleteProfile.isPending}
                  >
                    <Trash2 /> Xoá profile
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProfileFormDialog
        open={editProfile !== null}
        onOpenChange={(open) => {
          if (!open) setEditProfile(null);
        }}
        profile={editProfile}
      />

      <ProfileSetPinDialog
        open={pinTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPinTarget(null);
        }}
        profile={pinTarget?.profile ?? null}
        mode={pinTarget?.mode ?? "set"}
      />

      <ProfilePinDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={deleteTarget ? `Xoá ${deleteTarget.name}` : "Xoá profile"}
        description="Nhập PIN của profile để xác nhận xoá. Toàn bộ dữ liệu của profile này sẽ bị xoá vĩnh viễn."
        onSubmit={submitDeletePin}
        error={deleteError}
        pending={deleteProfile.isPending}
        confirmLabel="Xác nhận xoá"
      />
    </section>
  );
}
