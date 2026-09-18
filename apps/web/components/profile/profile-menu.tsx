"use client";

import Link from "next/link";
import { Check, ChevronDown, Lightbulb, Lock, Settings, Users } from "lucide-react";
import { useState } from "react";

import { ProfileAvatar } from "@/components/profile/profile-avatar";
import {
  ProfilePinDialog,
  pinErrorMessage,
} from "@/components/profile/profile-pin-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { ApiError, toVietnameseMessage } from "@/lib/errors";
import {
  useCurrentProfile,
  useProfiles,
  useSwitchProfile,
  type ProfileListItem,
} from "@/lib/profiles";

export function ProfileMenu() {
  const toast = useToast();
  const current = useCurrentProfile();
  const list = useProfiles();
  const switchProfile = useSwitchProfile();
  const [locked, setLocked] = useState<ProfileListItem | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  if (current.isLoading) {
    return <Skeleton className="size-9 rounded-full" />;
  }
  if (current.isError || !current.data) return null;

  const profile = current.data;

  const handleSelect = (item: ProfileListItem) => {
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
        onError: (error: unknown) => {
          // Stale `has_pin` (PIN set on another device): the server replies
          // PIN_REQUIRED, so ask for the PIN instead of a generic toast.
          if (error instanceof ApiError && error.code === "PIN_REQUIRED") {
            setPinError(null);
            setLocked(item);
            return;
          }
          toast(toVietnameseMessage(error), "error");
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
        onError: (error: unknown) => setPinError(pinErrorMessage(error)),
      },
    );
  };

  return (
    <>
      {/* modal={false}: a transient menu must not lock the page scroll.
          Radix's default modal mode hides the viewport scrollbar while open,
          which makes the whole page flicker on open/close. The nav menu in
          SiteHeader does the same. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chọn profile"
            className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors"
          >
            <ProfileAvatar avatar={profile.avatar} className="size-8 text-lg" />
            <span className="hidden max-w-24 truncate text-sm font-medium sm:block">
              {profile.name}
            </span>
            <ChevronDown className="text-muted-foreground hidden size-3.5 sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Profile</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/profiles">
              <Users /> Đổi profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {list.isLoading && (
            <DropdownMenuItem disabled>Đang tải...</DropdownMenuItem>
          )}
          {list.data?.items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => handleSelect(item)}
              className="gap-2"
            >
              <ProfileAvatar
                avatar={item.avatar}
                className="size-7 text-base"
              />
              <span className="flex-1 truncate">{item.name}</span>
              {item.has_pin && (
                <Lock className="text-muted-foreground size-3.5" />
              )}
              {item.is_current && <Check className="text-brand size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/me/taste">
              <Lightbulb /> Gu của tôi
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/profiles/manage">
              <Settings /> Quản lý profile
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}
