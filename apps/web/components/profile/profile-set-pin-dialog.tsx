"use client";

import { useEffect, useState } from "react";

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
import { useSetProfilePin, type Profile } from "@/lib/profiles";

function setPinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_PASSWORD")
      return "Mật khẩu tài khoản không đúng.";
    if (error.code === "PIN_REQUIRED") return "Profile này cần PIN hiện tại.";
    if (error.code === "INVALID_PIN") return "PIN hiện tại không đúng.";
    if (error.code === "PROFILE_NOT_FOUND") return "Không tìm thấy profile.";
  }
  return toVietnameseMessage(error);
}

interface ProfileSetPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile | null;
  mode: "set" | "clear";
}

export function ProfileSetPinDialog({
  open,
  onOpenChange,
  profile,
  mode,
}: ProfileSetPinDialogProps) {
  const toast = useToast();
  const setPin = useSetProfilePin();
  const [password, setPassword] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPinValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isClear = mode === "clear";
  const requiresCurrent = profile?.has_pin === true;
  const title = isClear
    ? "Xoá PIN"
    : profile?.has_pin
      ? "Đổi PIN"
      : "Đặt PIN";

  useEffect(() => {
    if (open) return;
    setPassword("");
    setCurrentPin("");
    setPinValue("");
    setError(null);
  }, [open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || setPin.isPending) return;
    if (!isClear && pin.length !== 4) return;
    if (requiresCurrent && currentPin.length !== 4) return;

    setPin.mutate(
      {
        id: profile.id,
        password,
        pin: isClear ? null : pin,
        ...(requiresCurrent ? { currentPin } : {}),
      },
      {
        onSuccess: () => {
          toast(isClear ? "Đã xoá PIN." : "Đã lưu PIN.", "success");
          onOpenChange(false);
        },
        onError: (err: unknown) => setError(setPinErrorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {isClear
            ? requiresCurrent
              ? "Nhập PIN hiện tại và mật khẩu tài khoản để xoá PIN của profile này."
              : "Nhập mật khẩu tài khoản để xoá PIN của profile này."
            : requiresCurrent
              ? "Nhập PIN hiện tại, mật khẩu tài khoản và mã PIN 4 chữ số mới cho profile này."
              : "Nhập mật khẩu tài khoản và mã PIN 4 chữ số cho profile này."}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {requiresCurrent && (
            <div className="space-y-1.5">
              <label
                htmlFor="current-profile-pin"
                className="text-sm font-medium"
              >
                PIN hiện tại
              </label>
              <Input
                id="current-profile-pin"
                aria-label="PIN hiện tại"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={currentPin}
                onChange={(event) =>
                  setCurrentPin(
                    event.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
                placeholder="••••"
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="account-password" className="text-sm font-medium">
              Mật khẩu tài khoản
            </label>
            <Input
              id="account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </div>
          {!isClear && (
            <div className="space-y-1.5">
              <label htmlFor="new-profile-pin" className="text-sm font-medium">
                PIN mới
              </label>
              <Input
                id="new-profile-pin"
                aria-label="PIN mới"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(event) =>
                  setPinValue(event.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="••••"
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
          )}
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
              disabled={setPin.isPending}
            >
              Huỷ
            </Button>
            <Button
              type="submit"
              disabled={
                setPin.isPending ||
                password.length === 0 ||
                (requiresCurrent && currentPin.length !== 4) ||
                (!isClear && pin.length !== 4)
              }
            >
              {setPin.isPending ? "Đang lưu..." : "Lưu"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
