import Link from "next/link";
import { Clapperboard } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <Clapperboard className="size-5 text-brand" />
          <span>
            g<span className="text-brand">mov</span>
          </span>
        </div>
        <p className="text-center">
          Dữ liệu phim từ nguồn công khai NguonC. Chỉ phục vụ học tập.
        </p>
        <div className="flex gap-4">
          <Link href="/login" className="hover:text-foreground">
            Đăng nhập
          </Link>
          <Link href="/register" className="hover:text-foreground">
            Đăng ký
          </Link>
        </div>
      </div>
    </footer>
  );
}
