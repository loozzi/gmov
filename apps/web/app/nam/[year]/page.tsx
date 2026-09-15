"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

import { MovieGrid } from "@/components/movies/movie-grid";
import { useYear } from "@/lib/movies";

export default function YearPage() {
  const params = useParams<{ year: string }>();
  const [page, setPage] = useState(1);
  const query = useYear(params.year, page);

  return (
    <MovieGrid
      title={`Phim năm ${params.year}`}
      query={query}
      page={page}
      onPage={setPage}
    />
  );
}
