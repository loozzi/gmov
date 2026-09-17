"use client";

import { Lock, Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileFormDialog } from "@/components/profile/profile-form-dialog";
import {
  ProfilePinDialog,
  pinErrorMessage,
} from "@/components/profile/profile-pin-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import {
  consumeProfilePicker,
  getProfilePickerPending,
  getServerProfilePickerPending,
  subscribeProfilePicker,
} from "@/lib/profile-picker";
import {
  useProfiles,
  useSwitchProfile,
  type ProfileListItem,
} from "@/lib/profiles";
import { cn } from "@/lib/utils";

function ProfilePickerOverlay() {
  const toast = useToast();
  const { data, isLoading } = useProfiles();
  const switchProfile = useSwitchProfile();
  const pending = useSyncExternalStore(
    subscribeProfilePicker,
    getProfilePickerPending,
    getServerProfilePickerPending,
  );
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState<ProfileListItem | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!pending || isLoading) return;
    consumeProfilePicker();
    // Only accounts with two or more profiles get the picker; a single-profile
    // account silently skips it (the intent is still consumed).
    if (data && data.items.length >= 2) setOpen(true);
  }, [pending, isLoading, data]);

  const handleSelect = (item: ProfileListItem) => {
    setSwitchError(null);
    if (item.is_current) {
      setOpen(false);
      return;
    }
    if (item.has_pin) {
      setPinError(null);
      setLocked(item);
      return;
    }
    switchProfile.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          setOpen(false);
          toast(`Đã chuyển sang ${item.name}.`, "success");
        },
        onError: (error: unknown) => setSwitchError(toVietnameseMessage(error)),
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
          setOpen(false);
          toast(`Đã chuyển sang ${target.name}.`, "success");
        },
        onError: (error: unknown) => setPinError(pinErrorMessage(error)),
      },
    );
  };

  if (!open) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="max-w-lg" data-testid="profile-picker">
          <DialogTitle>Ai đang xem?</DialogTitle>
          <DialogDescription>
            Chọn profile để tiếp tục. Bạn có thể đổi profile bất cứ lúc nào.
          </DialogDescription>
          <div className="mt-6 flex flex-wrap justify-center gap-6">
            {data?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                disabled={switchProfile.isPending}
                data-testid={`profile-picker-option-${item.id}`}
                aria-label={
                  item.is_current ? `${item.name} (đang xem)` : item.name
                }
                className="group flex w-24 cursor-pointer flex-col items-center gap-2 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="relative">
                  <ProfileAvatar
                    avatar={item.avatar}
                    className={cn(
                      "size-20 text-4xl transition-transform group-hover:scale-105",
                      item.is_current && "ring-brand ring-2",
                    )}
                  />
                  {item.has_pin && (
                    <span className="bg-card border-border absolute -right-1 -bottom-1 rounded-full border p-1">
                      <Lock className="size-3" />
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
            ))}
            {data && data.items.length < data.max && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                data-testid="profile-picker-add"
                aria-label="Thêm profile"
                className="group flex w-24 cursor-pointer flex-col items-center gap-2"
              >
                <span className="border-border text-muted-foreground group-hover:border-brand group-hover:text-brand flex size-20 items-center justify-center rounded-full border-2 border-dashed transition-colors">
                  <Plus className="size-7" />
                </span>
                <span className="text-sm font-medium">Thêm profile</span>
              </button>
            )}
          </div>
          {switchError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300"
            >
              {switchError}
            </p>
          )}
          <div className="mt-6 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              data-testid="profile-picker-dismiss"
              onClick={() => setOpen(false)}
              disabled={switchProfile.isPending}
            >
              Để sau
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ProfilePinDialog
        open={locked !== null}
        onOpenChange={(next) => {
          if (!next) {
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
    </>
  );
}

export function ProfilePickerGate() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return <ProfilePickerOverlay />;
}
