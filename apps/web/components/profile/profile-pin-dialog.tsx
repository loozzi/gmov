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
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description ?? "Nhập mã PIN gồm 4 chữ số của profile."}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Input
            id="profile-pin"
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
            className="text-center text-lg tracking-[0.5em]"
          />
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
            <Button type="submit" disabled={pin.length !== 4 || pending}>
              {pending ? "Đang kiểm tra..." : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
