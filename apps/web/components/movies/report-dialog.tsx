"use client";

import { useEffect, useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Flag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/moderation";

const REASONS: ReportReason[] = ["spam", "harassment", "spoiler", "other"];

export interface ReportSubmitInput {
  reason: ReportReason;
  note: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ReportSubmitInput) => void;
  isPending?: boolean;
}

export function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending = false,
}: Props) {
  const groupName = useId();
  const noteId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) {
      setReason(null);
      setNote("");
    }
  }, [open]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (isPending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl focus:outline-none">
          <div className="flex items-start gap-3">
            <Flag className="mt-0.5 size-5 shrink-0 text-brand" />
            <div className="flex-1">
              <DialogPrimitive.Title className="text-base font-semibold">
                Báo cáo bình luận
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                Chọn lý do bạn thấy bình luận này không phù hợp.
              </DialogPrimitive.Description>
            </div>
          </div>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Lý do báo cáo</legend>
            {REASONS.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <input
                  type="radio"
                  name={groupName}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="cursor-pointer accent-brand"
                />
                {REPORT_REASON_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <div className="mt-4 space-y-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              Ghi chú (không bắt buộc)
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Thêm mô tả…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Hủy
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!reason || isPending}
              onClick={() => {
                if (reason) onSubmit({ reason, note: note.trim() || null });
              }}
            >
              {isPending ? "Đang gửi…" : "Gửi báo cáo"}
            </Button>
          </div>
          <DialogPrimitive.Close
            aria-label="Đóng"
            disabled={isPending}
            className="absolute top-4 right-4 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
