"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { CommentItem } from "@/components/movies/comment-item";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import { useAddComment, useComments } from "@/lib/reviews";

interface Props {
  movieSlug: string;
}

export function CommentSection({ movieSlug }: Props) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError, error } = useComments(
    movieSlug,
    page,
  );
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
          <div
            className={
              isFetching ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"
            }
            aria-busy={isFetching}
          >
            {data.items.map((c) => (
              <CommentItem key={c.id} movieSlug={movieSlug} comment={c} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft /> Trước
            </Button>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {isFetching && <Loader2 className="size-4 animate-spin" />}
              Trang {data.page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                data.page * data.per_page >= data.total_items || isFetching
              }
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
