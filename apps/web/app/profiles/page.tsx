"use client";

import Link from "next/link";
import { Lock, Plus, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";

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
      className="group flex w-28 cursor-pointer flex-col items-center gap-2 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="relative">
        <ProfileAvatar
          avatar={item.avatar}
          className={cn(
            "size-24 text-5xl transition-transform group-hover:scale-105",
            item.is_current && "ring-brand ring-2",
          )}
        />
        {item.has_pin && (
          <span className="bg-card border-border absolute -right-1 -bottom-1 rounded-full border p-1.5">
            <Lock className="size-3.5" />
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-sm font-medium">
        {item.name}
      </span>
      {item.is_current && (
        <span className="text-brand text-xs">Đang xem</span>
      )}
    </button>
  );
}

export default function ProfilesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useProfiles();
  const switchProfile = useSwitchProfile();
  const [locked, setLocked] = useState<ProfileListItem | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [switchError, setSwitchError] = useState<string | null>(null);

  const handleSelect = (item: ProfileListItem) => {
    setSwitchError(null);
    if (item.is_current) return;
    if (item.has_pin) {
      setPinError(null);
      setLocked(item);
      return;
    }
    switchProfile.mutate(
      { id: item.id },
      {
        onSuccess: () => toast(`Đã chuyển sang ${item.name}.`, "success"),
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
        },
        onError: (err: unknown) => setPinError(pinErrorMessage(err)),
      },
    );
  };

  if (authLoading) {
    return (
      <div className="flex flex-wrap justify-center gap-6 py-12">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="size-24 rounded-full" />
        ))}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold">Ai đang xem?</h1>
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để chọn profile.
        </p>
        <Button asChild>
          <Link href="/login?next=/profiles">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  return (
    <section className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Ai đang xem?</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/profiles/manage">
            <Settings /> Quản lý profile
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-10 flex flex-wrap justify-center gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="size-24 rounded-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
          <p className="font-medium">Không tải được danh sách profile.</p>
          <p className="text-sm text-muted-foreground">
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
              className="mx-auto mt-6 max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300"
            >
              {switchError}
            </p>
          )}
          <div className="mt-10 flex flex-wrap justify-center gap-8">
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
                className="group flex w-28 cursor-pointer flex-col items-center gap-2"
              >
                <span className="border-border text-muted-foreground group-hover:border-brand group-hover:text-brand flex size-24 items-center justify-center rounded-full border-2 border-dashed transition-colors">
                  <Plus className="size-8" />
                </span>
                <span className="text-sm font-medium">Thêm profile</span>
              </button>
            )}
          </div>
        </>
      )}

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
