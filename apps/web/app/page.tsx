"use client";

import { useState } from "react";

import { MovieGrid } from "@/components/movies/movie-grid";
import { useLatest } from "@/lib/movies";

export default function Home() {
  const [page, setPage] = useState(1);
  const query = useLatest(page);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand/30 via-card to-card p-8 sm:p-12">
        <p className="text-sm font-medium text-brand">Xem phim mỗi ngày</p>
        <h1 className="mt-2 max-w-xl text-3xl font-bold sm:text-4xl">
          Khám phá hàng nghìn bộ phim hay, cập nhật liên tục
        </h1>
        <p className="mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          Tìm kiếm, lọc theo thể loại, quốc gia, năm phát hành — và theo dõi
          tiến độ xem của bạn trên mọi thiết bị.
        </p>
      </section>

      <MovieGrid
        title="Mới cập nhật"
        subtitle="Những bộ phim vừa được bổ sung"
        query={query}
        page={page}
        onPage={setPage}
      />
    </div>
  );
}
