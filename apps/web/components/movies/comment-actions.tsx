"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ReportDialog } from "@/components/movies/report-dialog";
import { useToast } from "@/components/ui/toaster";
import {
  useHideComment,
  useReportComment,
  useReportStatus,
  useUnhideComment,
} from "@/lib/moderation";

export function ReportAction({ commentId }: { commentId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data } = useReportStatus(commentId);
  const report = useReportComment();

  if (data?.reported) {
    return (
      <button
        type="button"
        disabled
        className="cursor-not-allowed text-xs text-muted-foreground"
      >
        Đã báo cáo
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Báo cáo
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
              onError: () =>
                toast("Không thể gửi báo cáo. Thử lại nhé.", "error"),
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
      onError: () => toast("Thao tác thất bại. Thử lại nhé.", "error"),
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
  deletePending,
  onDelete,
  deleteLabel,
}: {
  movieSlug: string;
  commentId: string;
  isHidden: boolean;
  isOwner: boolean;
  canReport: boolean;
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
      {canReport && <ReportAction commentId={commentId} />}
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
