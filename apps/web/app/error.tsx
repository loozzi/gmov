"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({
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
    <div className="animate-reveal-up flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-bold">Đã xảy ra lỗi</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        {error.message || "Không tải được nội dung. Hãy thử lại sau."}
      </p>
      <Button onClick={reset}>Thử lại</Button>
    </div>
  );
}
