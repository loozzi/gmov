"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type ReportReason = "spam" | "harassment" | "spoiler" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportSource = "user" | "auto";
export type ReportsFilter = ReportStatus | "all";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Quấy rối, xúc phạm",
  spoiler: "Tiết lộ nội dung",
  other: "Khác",
};

export interface AdminCommentUser {
  id: string;
  username: string;
  display_name: string;
  banned_at: string | null;
}

export interface ReportedComment {
  id: string;
  body: string | null;
  is_hidden: boolean;
  has_spoiler: boolean;
  movie_slug: string;
  user: AdminCommentUser;
  created_at: string;
}

export interface ReportItem {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  source: ReportSource;
  created_at: string;
  reporter: AdminCommentUser | null;
  comment: ReportedComment;
}

export interface BanUserResponse {
  id: string;
  username: string;
  banned_at: string | null;
  ban_reason: string | null;
}

export interface BanUserInput {
  userId: string;
  reason?: string | null;
}

export interface PaginatedReports {
  items: ReportItem[];
  page: number;
  per_page: number;
  total_items: number;
  open_total: number;
}

export interface ReportCommentInput {
  commentId: string;
  reason: ReportReason;
  note?: string | null;
}

export function useReportComment(movieSlug: string) {
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "comments", movieSlug],
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

type CommentFlagAction = "hide" | "unhide" | "spoiler" | "unspoiler";

function useCommentModeration(movieSlug: string, action: CommentFlagAction) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<{ ok: boolean; is_hidden: boolean; has_spoiler: boolean }>(
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

export function useMarkSpoiler(movieSlug: string) {
  return useCommentModeration(movieSlug, "spoiler");
}

export function useUnmarkSpoiler(movieSlug: string) {
  return useCommentModeration(movieSlug, "unspoiler");
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

export function useBanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: BanUserInput) =>
      apiFetch<BanUserResponse>(`/api/v1/admin/users/${userId}/ban`, {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}

export function useUnbanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<BanUserResponse>(`/api/v1/admin/users/${userId}/unban`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}
