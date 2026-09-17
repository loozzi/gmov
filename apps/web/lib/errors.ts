import type { ApiErrorShape } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CODE_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: "Email này đã được đăng ký.",
  USERNAME_TAKEN: "Tên đăng nhập đã có người dùng.",
  INVALID_CREDENTIALS: "Thông tin đăng nhập không đúng.",
  ACCOUNT_DISABLED: "Tài khoản đã bị vô hiệu hóa.",
  INVALID_REFRESH_TOKEN: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  UNAUTHORIZED: "Bạn cần đăng nhập để tiếp tục.",
  VALIDATION_ERROR: "Dữ liệu nhập chưa hợp lệ.",
  MOVIE_NOT_FOUND: "Không tìm thấy phim.",
  PROGRESS_NOT_FOUND: "Chưa có tiến độ xem cho phim này.",
  INVALID_LIST_TYPE: "Danh mục không hợp lệ.",
  INVALID_YEAR: "Năm không hợp lệ.",
  RATE_LIMITED: "Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.",
  BOT_DETECTED: "Yêu cầu đăng ký không hợp lệ.",
  SESSION_STALE: "Phiên đăng nhập đã cũ, vui lòng thử lại.",
  PROFILE_NOT_FOUND: "Không tìm thấy profile.",
  DEFAULT_PROFILE: "Không thể xoá profile mặc định.",
  PROFILE_LIMIT_REACHED: "Đã đạt giới hạn số profile.",
  PROFILE_NAME_TAKEN: "Tên profile đã được sử dụng.",
  PIN_REQUIRED: "Profile này cần PIN.",
  INVALID_PIN: "PIN không đúng.",
  CANNOT_REPORT_OWN: "Bạn không thể báo cáo bình luận của chính mình.",
  COMMENT_HIDDEN: "Bình luận này đã bị ẩn.",
  REPORT_NOT_FOUND: "Không tìm thấy báo cáo.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  INVALID_ROLE: "Vai trò không hợp lệ.",
  UPSTREAM_ERROR: "Nguồn phim tạm thời lỗi. Hãy thử lại sau.",
  HTTP_ERROR: "Đã xảy ra lỗi. Hãy thử lại.",
  INTERNAL_ERROR: "Lỗi hệ thống. Hãy thử lại sau.",
};

function detailToString(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    if (first && typeof first.msg === "string") {
      return first.msg.replace(/^Value error,\s*/, "");
    }
  }
  return null;
}

export function toVietnameseMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return CODE_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "Đã xảy ra lỗi. Hãy thử lại.";
}

export function parseApiError(status: number, body: unknown): ApiError {
  const shape = body as Partial<ApiErrorShape>;
  const code =
    typeof shape?.code === "string" ? shape.code : "HTTP_ERROR";
  const message =
    detailToString(shape?.detail) ??
    CODE_MESSAGES[code] ??
    `Yêu cầu thất bại (HTTP ${status}).`;
  return new ApiError(status, code, message);
}
