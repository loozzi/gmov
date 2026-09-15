"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="vi" className="dark">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4 text-center text-foreground">
        <h1 className="text-2xl font-bold">Ứng dụng gặp sự cố</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Đã xảy ra lỗi nghiêm trọng. Hãy tải lại trang, nếu vẫn lỗi vui lòng
          thử lại sau.
        </p>
        <div className="flex gap-2">
          <Button onClick={reset}>Tải lại</Button>
          <Button variant="secondary" asChild>
            <Link href="/">Về trang chủ</Link>
          </Button>
        </div>
      </body>
    </html>
  );
}
