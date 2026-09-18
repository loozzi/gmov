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
import { ApiError, toVietnameseMessage } from "@/lib/errors";

export function pinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_PIN") return "PIN không đúng";
    if (error.code === "PIN_REQUIRED") return "Profile này cần PIN";
  }
  return toVietnameseMessage(error);
}

interface ProfilePinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onSubmit: (pin: string) => void;
  error?: string | null;
  description?: string;
  pending?: boolean;
  confirmLabel?: string;
}

export function ProfilePinDialog({
  open,
  onOpenChange,
  title,
  onSubmit,
  error,
  description,
  pending = false,
  confirmLabel = "Xác nhận",
}: ProfilePinDialogProps) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (!open) setPin("");
  }, [open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pin.length !== 4 || pending) return;
    onSubmit(pin);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreen
        data-testid="profile-pin-dialog"
        className="flex flex-col items-center justify-center gap-4 text-center"
      >
        <DialogTitle className="text-2xl">{title}</DialogTitle>
        <DialogDescription className="max-w-sm text-neutral-400">
          {description ?? "Nhập mã PIN gồm 4 chữ số của profile."}
        </DialogDescription>
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xs flex-col items-center gap-3"
        >
          {/* type=password: the PIN must never be readable on screen. */}
          <Input
            id="profile-pin"
            type="password"
            aria-label="Mã PIN"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            autoFocus
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="••••"
            className="border-neutral-700 bg-neutral-900 text-center text-lg tracking-[0.5em] text-neutral-50 placeholder:text-neutral-600"
          />
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-center gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="text-neutral-300 hover:bg-white/10 hover:text-neutral-50"
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={pin.length !== 4 || pending}>
              {pending ? "Đang kiểm tra..." : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
