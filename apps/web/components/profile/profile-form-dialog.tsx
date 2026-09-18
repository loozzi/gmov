"use client";

import { useEffect, useState } from "react";

import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { ApiError, toVietnameseMessage } from "@/lib/errors";
import {
  AVATAR_KEYS,
  useCreateProfile,
  useUpdateProfile,
  type Profile,
} from "@/lib/profiles";

function formErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "PROFILE_LIMIT_REACHED")
      return "Bạn đã đạt giới hạn số profile.";
    if (error.code === "PROFILE_NAME_TAKEN")
      return "Tên profile này đã được dùng.";
    if (error.code === "PROFILE_NOT_FOUND") return "Không tìm thấy profile.";
    if (error.code === "PIN_REQUIRED") return "Profile này cần PIN.";
    if (error.code === "INVALID_PIN") return "PIN không đúng.";
  }
  return toVietnameseMessage(error);
}

interface ProfileFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: Profile | null;
}

export function ProfileFormDialog({
  open,
  onOpenChange,
  profile = null,
}: ProfileFormDialogProps) {
  const toast = useToast();
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATAR_KEYS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // Stored `has_pin` can be stale (set from another device); the server then
  // answers PIN_REQUIRED, so reveal the field instead of trapping the user.
  const [pinRequired, setPinRequired] = useState(false);

  const isEdit = profile !== null;
  const pending = create.isPending || update.isPending;
  const needsPin = isEdit && (profile?.has_pin === true || pinRequired);
  const pinComplete = /^\d{4}$/.test(pin);
  const canSubmit =
    name.trim().length > 0 && !pending && (!needsPin || pinComplete);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setAvatar(profile?.avatar ?? AVATAR_KEYS[0]);
    setPin("");
    setPinRequired(false);
    setError(null);
  }, [open, profile]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;

    const onSuccess = () => {
      toast(isEdit ? "Đã cập nhật profile." : "Đã tạo profile.", "success");
      onOpenChange(false);
    };
    const onError = (err: unknown) => {
      // A profile with a PIN needs it even to be renamed: the server says so.
      if (err instanceof ApiError && err.code === "PIN_REQUIRED") {
        setPinRequired(true);
      }
      setError(formErrorMessage(err));
    };

    if (isEdit && profile) {
      update.mutate(
        { id: profile.id, name: trimmed, avatar, ...(pin ? { pin } : {}) },
        { onSuccess, onError },
      );
      return;
    }
    create.mutate({ name: trimmed, avatar }, { onSuccess, onError });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{isEdit ? "Sửa profile" : "Thêm profile"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Đổi tên hoặc ảnh đại diện của profile."
            : "Đặt tên và chọn ảnh đại diện cho profile mới."}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="profile-name" className="text-sm font-medium">
              Tên profile
            </label>
            <Input
              id="profile-name"
              value={name}
              maxLength={32}
              autoComplete="off"
              placeholder="Ví dụ: Bé Na"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {needsPin && (
            <div className="space-y-1.5">
              <label htmlFor="profile-pin" className="text-sm font-medium">
                Mã PIN
              </label>
              <Input
                id="profile-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                placeholder="4 chữ số"
                onChange={(event) => setPin(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Profile này có PIN — nhập PIN để đổi tên hoặc ảnh đại diện.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Ảnh đại diện</span>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Chọn avatar ${key}`}
                  aria-pressed={avatar === key}
                  onClick={() => setAvatar(key)}
                  className={
                    avatar === key
                      ? "ring-brand cursor-pointer rounded-full ring-2"
                      : "cursor-pointer rounded-full opacity-70 hover:opacity-100"
                  }
                >
                  <ProfileAvatar avatar={key} className="size-10 text-xl" />
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? "Đang lưu..." : isEdit ? "Lưu" : "Tạo profile"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
