"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import {
  REPORT_REASON_LABELS,
  useDismissReport,
  useHideComment,
  useReports,
  useUnhideComment,
  type ReportItem,
  type ReportsFilter,
  type ReportStatus,
} from "@/lib/moderation";
import type { CommentUser } from "@/lib/reviews";
import { cn } from "@/lib/utils";

const TABS: { value: ReportsFilter; label: string }[] = [
  { value: "open", label: "Đang mở" },
  { value: "resolved", label: "Đã xử lý" },
  { value: "dismissed", label: "Đã bỏ qua" },
  { value: "all", label: "Tất cả" },
];

const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Đang mở",
  resolved: "Đã xử lý",
  dismissed: "Đã bỏ qua",
};

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("vi-VN");
}

function UserLabel({ user }: { user: CommentUser }) {
  return <span title={`@${user.username}`}>{user.display_name}</span>;
}

function ReportRow({ item }: { item: ReportItem }) {
  const toast = useToast();
  const hide = useHideComment(item.comment.movie_slug);
  const unhide = useUnhideComment(item.comment.movie_slug);
  const dismiss = useDismissReport();
  const isHidden = item.comment.is_hidden;
  const pending = hide.isPending || unhide.isPending || dismiss.isPending;

  const handleToggle = () => {
    const options = {
      onSuccess: () =>
        toast(
          isHidden ? "Đã bỏ ẩn bình luận." : "Đã ẩn bình luận.",
          "success",
        ),
      onError: (error: unknown) => toast(toVietnameseMessage(error), "error"),
    };
    if (isHidden) unhide.mutate(item.comment.id, options);
    else hide.mutate(item.comment.id, options);
  };

  const handleDismiss = () => {
    dismiss.mutate(item.id, {
      onSuccess: () => toast("Đã bỏ qua báo cáo.", "success"),
      onError: (error: unknown) => toast(toVietnameseMessage(error), "error"),
    });
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand">
          {REPORT_REASON_LABELS[item.reason]}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5">
          {STATUS_LABELS[item.status]}
        </span>
        {isHidden && (
          <span className="rounded-full bg-muted px-2 py-0.5">
            Bình luận đang ẩn
          </span>
        )}
        <span>{formatDate(item.created_at)}</span>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Người báo cáo: </span>
        <UserLabel user={item.reporter} />
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">Phim: </span>
        <Link
          href={`/phim/${item.comment.movie_slug}`}
          className="text-brand hover:underline"
        >
          {item.comment.movie_slug}
        </Link>
      </p>
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          <UserLabel user={item.comment.user} /> ·{" "}
          {formatDate(item.comment.created_at)}
        </p>
        <p className="mt-1 text-sm whitespace-pre-wrap">
          {item.comment.body ?? "Bình luận đã bị ẩn"}
        </p>
      </div>
      {item.note && (
        <p className="text-sm">
          <span className="text-muted-foreground">Ghi chú: </span>
          {item.note}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleToggle}
          disabled={pending}
        >
          {isHidden ? "Bỏ ẩn" : "Ẩn"}
        </Button>
        {item.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDismiss}
            disabled={pending}
          >
            Bỏ qua
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminReportsPage() {
  const [status, setStatus] = useState<ReportsFilter>("open");
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError, error } = useReports(
    status,
    page,
  );

  const switchTab = (value: ReportsFilter) => {
    setStatus(value);
    setPage(1);
  };

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total_items / data.per_page))
    : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => switchTab(t.value)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1.5 text-sm",
                status === t.value
                  ? "bg-brand text-brand-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {data && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {isFetching && <Loader2 className="size-4 animate-spin" />}
            {data.open_total} báo cáo đang mở
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {toVietnameseMessage(error)}
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Không có báo cáo nào.
        </p>
      ) : (
        <>
          <div
            className={
              isFetching ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"
            }
            aria-busy={isFetching}
          >
            {data.items.map((item) => (
              <ReportRow key={item.id} item={item} />
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
            <span className="text-sm text-muted-foreground">
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
