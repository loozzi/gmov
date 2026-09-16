"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { CommentActionsBar } from "@/components/movies/comment-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import {
  useAddComment,
  useDeleteComment,
  type CommentReply,
  type MovieComment,
} from "@/lib/reviews";

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("vi-VN");
}

function Avatar({ name }: { name: string }) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase"
    >
      {initial}
    </div>
  );
}

function CommentBody({
  body,
  isHidden,
  isModerator,
}: {
  body: string | null;
  isHidden: boolean;
  isModerator: boolean;
}) {
  if (body === null || (isHidden && !isModerator)) {
    return (
      <p className="text-sm text-muted-foreground italic">Bình luận đã bị ẩn</p>
    );
  }
  return <p className="text-sm whitespace-pre-wrap">{body}</p>;
}

function ReplyItem({
  movieSlug,
  reply,
}: {
  movieSlug: string;
  reply: CommentReply;
}) {
  const { user, isAuthenticated, isModerator } = useAuth();
  const toast = useToast();
  const del = useDeleteComment(movieSlug);
  const isOwner = user?.username === reply.user.username;
  const isHidden = reply.is_hidden;
  const canReport = isAuthenticated && !isOwner && !isHidden;

  const handleDelete = () => {
    if (!window.confirm("Xóa trả lời này?")) return;
    del.mutate(reply.id, {
      onSuccess: () => toast("Đã xóa trả lời.", "success"),
      onError: () => toast("Xóa thất bại. Thử lại nhé.", "error"),
    });
  };

  return (
    <div className="space-y-1 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Avatar name={reply.user.display_name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {reply.user.display_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(reply.created_at)}
          </p>
        </div>
        <CommentActionsBar
          movieSlug={movieSlug}
          commentId={reply.id}
          isHidden={isHidden}
          isOwner={isOwner}
          canReport={canReport}
          reported={reply.reported}
          deletePending={del.isPending}
          onDelete={handleDelete}
          deleteLabel="Xóa trả lời"
        />
      </div>
      <CommentBody
        body={reply.body}
        isHidden={isHidden}
        isModerator={isModerator}
      />
    </div>
  );
}

export function CommentItem({
  movieSlug,
  comment,
}: {
  movieSlug: string;
  comment: MovieComment;
}) {
  const { user, isAuthenticated, isModerator } = useAuth();
  const toast = useToast();
  const addReply = useAddComment(movieSlug);
  const del = useDeleteComment(movieSlug);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  const isOwner = user?.username === comment.user.username;
  const isHidden = comment.is_hidden;
  const canReport = isAuthenticated && !isOwner && !isHidden;

  const handleDelete = () => {
    if (!window.confirm("Xóa bình luận này?")) return;
    del.mutate(comment.id, {
      onSuccess: () => toast("Đã xóa bình luận.", "success"),
      onError: () => toast("Xóa thất bại. Thử lại nhé.", "error"),
    });
  };

  const handleReplySubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = replyBody.trim();
    if (!text) return;
    addReply.mutate(
      { body: text, parent_id: comment.id },
      {
        onSuccess: () => {
          setReplyBody("");
          setShowReply(false);
          toast("Đã gửi trả lời.", "success");
        },
        onError: () => toast("Không thể gửi trả lời. Thử lại nhé.", "error"),
      },
    );
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Avatar name={comment.user.display_name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {comment.user.display_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(comment.created_at)}
          </p>
        </div>
        <CommentActionsBar
          movieSlug={movieSlug}
          commentId={comment.id}
          isHidden={isHidden}
          isOwner={isOwner}
          canReport={canReport}
          reported={comment.reported}
          deletePending={del.isPending}
          onDelete={handleDelete}
          deleteLabel="Xóa bình luận"
        />
      </div>
      <CommentBody
        body={comment.body}
        isHidden={isHidden}
        isModerator={isModerator}
      />
      <div>
        <button
          type="button"
          onClick={() => setShowReply((v) => !v)}
          className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Trả lời
        </button>
      </div>
      {showReply &&
        (isAuthenticated ? (
          <form onSubmit={handleReplySubmit} className="space-y-2">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              required
              maxLength={2000}
              rows={2}
              placeholder="Viết câu trả lời…"
              aria-label="Nội dung trả lời"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={addReply.isPending || !replyBody.trim()}
              >
                Gửi trả lời
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowReply(false)}
              >
                Hủy
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Bạn cần{" "}
            <Link
              href={`/login?next=/phim/${movieSlug}`}
              className="underline underline-offset-4"
            >
              đăng nhập
            </Link>{" "}
            để trả lời.
          </p>
        ))}
      {comment.replies.length > 0 && (
        <div className="ml-2 space-y-2 border-l border-border pl-3">
          {comment.replies.map((r) => (
            <ReplyItem key={r.id} movieSlug={movieSlug} reply={r} />
          ))}
        </div>
      )}
    </div>
  );
}
