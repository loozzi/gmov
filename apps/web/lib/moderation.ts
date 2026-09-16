"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { CommentUser } from "@/lib/reviews";

export type ReportReason = "spam" | "harassment" | "spoiler" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportsFilter = ReportStatus | "all";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Quấy rối, xúc phạm",
  spoiler: "Tiết lộ nội dung",
  other: "Khác",
};

export interface ReportedComment {
  id: string;
  body: string | null;
  is_hidden: boolean;
  movie_slug: string;
  user: CommentUser;
  created_at: string;
}

export interface ReportItem {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: CommentUser;
  comment: ReportedComment;
}

export interface PaginatedReports {
  items: ReportItem[];
  page: number;
  per_page: number;
  total_items: number;
  open_total: number;
}

export function useReportStatus(commentId: string, enabled = true) {
  return useQuery({
    queryKey: ["reviews", "report-status", commentId],
    queryFn: () =>
      apiFetch<{ reported: boolean }>(`/api/v1/me/reports/${commentId}/status`),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export interface ReportCommentInput {
  commentId: string;
  reason: ReportReason;
  note?: string | null;
}

export function useReportComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, reason, note }: ReportCommentInput) =>
      apiFetch<{ id: string; status: ReportStatus }>("/api/v1/me/reports", {
        method: "POST",
        body: JSON.stringify({
          comment_id: commentId,
          reason,
          ...(note ? { note } : {}),
        }),
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "report-status", input.commentId],
      });
    },
  });
}

export function useReports(status: ReportsFilter, page = 1) {
  return useQuery({
    queryKey: ["admin", "reports", status, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "20",
      });
      if (status !== "all") params.set("status", status);
      return apiFetch<PaginatedReports>(
        `/api/v1/admin/reports?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

function useCommentModeration(movieSlug: string, action: "hide" | "unhide") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<{ ok: boolean; is_hidden: boolean }>(
        `/api/v1/admin/comments/${commentId}/${action}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "comments", movieSlug],
      });
    },
  });
}

export function useHideComment(movieSlug: string) {
  return useCommentModeration(movieSlug, "hide");
}

export function useUnhideComment(movieSlug: string) {
  return useCommentModeration(movieSlug, "unhide");
}

export function useDismissReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) =>
      apiFetch<{ ok: boolean }>(`/api/v1/admin/reports/${reportId}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}
