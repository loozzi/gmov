"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ReportDialog } from "@/components/movies/report-dialog";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import {
  useHideComment,
  useReportComment,
  useUnhideComment,
} from "@/lib/moderation";

export function ReportAction({
  movieSlug,
  commentId,
  reported,
}: {
  movieSlug: string;
  commentId: string;
  reported: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const report = useReportComment(movieSlug);
  const isReported = reported || report.isPending || report.isSuccess;

  return (
    <>
      <button
        type="button"
        disabled={isReported}
        onClick={() => setOpen(true)}
        className={
          isReported
            ? "cursor-not-allowed text-xs text-muted-foreground"
            : "cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        }
      >
        {isReported ? "Đã báo cáo" : "Báo cáo"}
      </button>
      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        isPending={report.isPending}
        onSubmit={(input) =>
          report.mutate(
            { commentId, reason: input.reason, note: input.note },
            {
              onSuccess: () => {
                setOpen(false);
                toast("Đã gửi báo cáo.", "success");
              },
              onError: (error: unknown) =>
                toast(toVietnameseMessage(error), "error"),
            },
          )
        }
      />
    </>
  );
}

export function ModerationActions({
  movieSlug,
  commentId,
  isHidden,
}: {
  movieSlug: string;
  commentId: string;
  isHidden: boolean;
}) {
  const toast = useToast();
  const hide = useHideComment(movieSlug);
  const unhide = useUnhideComment(movieSlug);
  const pending = hide.isPending || unhide.isPending;

  const handleClick = () => {
    const options = {
      onSuccess: () =>
        toast(isHidden ? "Đã bỏ ẩn bình luận." : "Đã ẩn bình luận.", "success"),
      onError: (error: unknown) => toast(toVietnameseMessage(error), "error"),
    };
    if (isHidden) unhide.mutate(commentId, options);
    else hide.mutate(commentId, options);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
    >
      {isHidden ? "Bỏ ẩn" : "Ẩn"}
    </button>
  );
}

export function CommentActionsBar({
  movieSlug,
  commentId,
  isHidden,
  isOwner,
  canReport,
  reported,
  deletePending,
  onDelete,
  deleteLabel,
}: {
  movieSlug: string;
  commentId: string;
  isHidden: boolean;
  isOwner: boolean;
  canReport: boolean;
  reported: boolean;
  deletePending: boolean;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const { isModerator } = useAuth();
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {isModerator && isHidden && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Đang ẩn
        </span>
      )}
      {isModerator && (
        <ModerationActions
          movieSlug={movieSlug}
          commentId={commentId}
          isHidden={isHidden}
        />
      )}
      {canReport && (
        <ReportAction
          movieSlug={movieSlug}
          commentId={commentId}
          reported={reported}
        />
      )}
      {isOwner && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deletePending}
          aria-label={deleteLabel}
          className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          Xóa
        </button>
      )}
    </div>
  );
}
