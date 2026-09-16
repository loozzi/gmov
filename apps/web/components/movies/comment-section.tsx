"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import {
  useAddComment,
  useComments,
  useDeleteComment,
  type CommentReply,
  type MovieComment,
} from "@/lib/reviews";

interface Props {
  movieSlug: string;
}

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

function ReplyItem({
  movieSlug,
  reply,
}: {
  movieSlug: string;
  reply: CommentReply;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const del = useDeleteComment(movieSlug);
  const isOwner = user?.username === reply.user.username;

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
        {isOwner && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            aria-label="Xóa trả lời"
            className="ml-auto cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Xóa
          </button>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap">{reply.body}</p>
    </div>
  );
}

function CommentItem({
  movieSlug,
  comment,
}: {
  movieSlug: string;
  comment: MovieComment;
}) {
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const addReply = useAddComment(movieSlug);
  const del = useDeleteComment(movieSlug);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  const isOwner = user?.username === comment.user.username;

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
        {isOwner && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            aria-label="Xóa bình luận"
            className="ml-auto cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Xóa
          </button>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
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

export function CommentSection({ movieSlug }: Props) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useComments(movieSlug, page);
  const addComment = useAddComment(movieSlug);
  const [body, setBody] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    addComment.mutate(
      { body: text },
      {
        onSuccess: () => {
          setBody("");
          toast("Đã gửi bình luận.", "success");
        },
        onError: () => toast("Không thể gửi bình luận. Thử lại nhé.", "error"),
      },
    );
  };

  if (authLoading || isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total_items / data.per_page))
    : 1;

  return (
    <div className="space-y-4">
      {!isAuthenticated ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Bạn cần đăng nhập để bình luận.
          </p>
          <Button asChild>
            <Link href={`/login?next=/phim/${movieSlug}`}>Đăng nhập</Link>
          </Button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={2000}
            rows={3}
            placeholder="Chia sẻ cảm nhận của bạn…"
            aria-label="Nội dung bình luận"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            disabled={addComment.isPending || !body.trim()}
          >
            Gửi bình luận
          </Button>
        </form>
      )}

      {isError ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {toVietnameseMessage(error)}
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Chưa có bình luận nào. Hãy là người đầu tiên chia sẻ nhé.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((c) => (
              <CommentItem key={c.id} movieSlug={movieSlug} comment={c} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft /> Trước
            </Button>
            <span className="text-sm text-muted-foreground">
              Trang {data.page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={data.page * data.per_page >= data.total_items}
              onClick={() => setPage(page + 1)}
            >
              Sau <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
