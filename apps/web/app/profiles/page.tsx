"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, LogOut, Plus, RefreshCw, Settings } from "lucide-react";
import { Suspense, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileFormDialog } from "@/components/profile/profile-form-dialog";
import {
  ProfilePinDialog,
  pinErrorMessage,
} from "@/components/profile/profile-pin-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { ApiError, toVietnameseMessage } from "@/lib/errors";
import { safeNextPath } from "@/lib/nav";
import {
  useProfiles,
  useSwitchProfile,
  type ProfileListItem,
} from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface ProfileCardProps {
  item: ProfileListItem;
  disabled: boolean;
  onSelect: (item: ProfileListItem) => void;
}

function ProfileCard({ item, disabled, onSelect }: ProfileCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      disabled={disabled}
      data-testid={`profile-card-${item.id}`}
      aria-label={item.is_current ? `${item.name} (đang xem)` : item.name}
      className="group flex w-32 cursor-pointer flex-col items-center gap-3 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="relative">
        <ProfileAvatar
          avatar={item.avatar}
          className={cn(
            "size-28 text-6xl transition-transform group-hover:scale-105 sm:size-32",
            item.is_current && "ring-brand ring-2",
          )}
        />
        {item.has_pin && (
          <span className="absolute -right-1 -bottom-1 rounded-full border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-300">
            <Lock className="size-3.5" />
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-base font-medium">
        {item.name}
      </span>
      {item.is_current && (
        <span className="text-brand -mt-2 text-xs">Đang xem</span>
      )}
    </button>
  );
}

function ProfilesChooser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useProfiles();
  const switchProfile = useSwitchProfile();
  const [locked, setLocked] = useState<ProfileListItem | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Always leave the chooser after a profile is picked (choosing is required).
  const leave = () => {
    const next = safeNextPath(searchParams.get("next"));
    // A `next` pointing back at the chooser (with any query, hash or trailing
    // slash) would demand a second pick.
    const path = next?.split(/[?#]/)[0].replace(/\/+$/, "");
    router.push(next && path !== "/profiles" ? next : "/");
  };

  const handleSelect = (item: ProfileListItem) => {
    setSwitchError(null);
    // Every pick goes through the server, the current profile included: the
    // session has no active profile until `switch` verifies the PIN, so
    // `is_current` must never short-circuit the check.
    if (item.has_pin) {
      setPinError(null);
      setLocked(item);
      return;
    }
    switchProfile.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          toast(`Đã chuyển sang ${item.name}.`, "success");
          leave();
        },
        onError: (err: unknown) => {
          // Stale `has_pin` (PIN set on another device): the server replies
          // PIN_REQUIRED, so collect the PIN here instead of showing raw text.
          if (err instanceof ApiError && err.code === "PIN_REQUIRED") {
            setSwitchError(null);
            setPinError(null);
            setLocked(item);
            return;
          }
          setSwitchError(toVietnameseMessage(err));
        },
      },
    );
  };

  const submitPin = (pin: string) => {
    if (!locked) return;
    const target = locked;
    switchProfile.mutate(
      { id: target.id, pin },
      {
        onSuccess: () => {
          setLocked(null);
          setPinError(null);
          toast(`Đã chuyển sang ${target.name}.`, "success");
          leave();
        },
        onError: (err: unknown) => setPinError(pinErrorMessage(err)),
      },
    );
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh flex-wrap items-center justify-center gap-8 bg-neutral-950">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="size-28 rounded-full bg-neutral-800" />
        ))}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-neutral-50">
        <h1 className="text-3xl font-bold">Ai đang xem?</h1>
        <p className="text-sm text-neutral-400">
          Bạn cần đăng nhập để chọn profile.
        </p>
        <Button asChild>
          <Link href="/login">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <section
      data-testid="profile-chooser"
      className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-neutral-950 px-6 py-12 text-neutral-50"
    >
      <h1 className="text-3xl font-bold sm:text-4xl">Ai đang xem?</h1>

      {isLoading ? (
        <div className="flex flex-wrap justify-center gap-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="size-28 rounded-full bg-neutral-800" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <p className="font-medium">Không tải được danh sách profile.</p>
          <p className="text-sm text-neutral-400">
            {toVietnameseMessage(error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw /> Thử lại
          </Button>
        </div>
      ) : (
        <>
          {switchError && (
            <p
              role="alert"
              className="max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300"
            >
              {switchError}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-8 sm:gap-10">
            {data.items.map((item) => (
              <ProfileCard
                key={item.id}
                item={item}
                disabled={switchProfile.isPending}
                onSelect={handleSelect}
              />
            ))}
            {data.items.length < data.max && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                data-testid="profile-add"
                aria-label="Thêm profile"
                className="group flex w-32 cursor-pointer flex-col items-center gap-3"
              >
                <span className="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-neutral-700 text-neutral-400 transition-colors group-hover:border-brand group-hover:text-brand sm:size-32">
                  <Plus className="size-8" />
                </span>
                <span className="text-base font-medium">Thêm profile</span>
              </button>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-neutral-400 hover:bg-white/10 hover:text-neutral-50"
        >
          <Link href="/profiles/manage">
            <Settings /> Quản lý profile
          </Link>
        </Button>
        {isAuthenticated && (
          // Escape hatch for someone who cannot get into any profile (all
          // locked, PIN forgotten): signing out must always be possible.
          <Button
            variant="ghost"
            size="sm"
            data-testid="chooser-logout"
            className="text-neutral-400 hover:bg-white/10 hover:text-neutral-50"
            onClick={() => void logout()}
          >
            <LogOut /> Đăng xuất
          </Button>
        )}
      </div>

      <ProfilePinDialog
        open={locked !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLocked(null);
            setPinError(null);
          }
        }}
        title={locked ? `Nhập PIN cho ${locked.name}` : "Nhập PIN"}
        onSubmit={submitPin}
        error={pinError}
        pending={switchProfile.isPending}
      />

      <ProfileFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </section>
  );
}

export default function ProfilesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh flex-wrap items-center justify-center gap-8 bg-neutral-950">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="size-28 rounded-full bg-neutral-800" />
          ))}
        </div>
      }
    >
      <ProfilesChooser />
    </Suspense>
  );
}
