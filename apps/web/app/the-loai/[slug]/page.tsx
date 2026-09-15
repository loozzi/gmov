"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

import { MovieGrid } from "@/components/movies/movie-grid";
import { GENRES, labelFor } from "@/lib/catalog";
import { useGenre } from "@/lib/movies";

export default function GenrePage() {
  const params = useParams<{ slug: string }>();
  const [page, setPage] = useState(1);
  const query = useGenre(params.slug, page);

  return (
    <MovieGrid
      title={`Thể loại: ${labelFor(GENRES, params.slug, params.slug)}`}
      query={query}
      page={page}
      onPage={setPage}
    />
  );
}
