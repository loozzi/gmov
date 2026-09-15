import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Ngoại tuyến",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl">📡</p>
      <h1 className="text-2xl font-bold">Bạn đang ngoại tuyến</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Không có kết nối mạng. Các trang đã xem và phim đang phát cần mạng để
        tải — hãy kết nối lại rồi thử tiếp nhé.
      </p>
      <Button asChild>
        <Link href="/">Về trang chủ</Link>
      </Button>
    </div>
  );
}
