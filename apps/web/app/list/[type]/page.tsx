"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

import { MovieGrid } from "@/components/movies/movie-grid";
import { labelFor, LIST_TYPES } from "@/lib/catalog";
import { useList } from "@/lib/movies";

export default function ListPage() {
  const params = useParams<{ type: string }>();
  const type = params.type;
  const [page, setPage] = useState(1);
  const query = useList(type, page);

  return (
    <MovieGrid
      title={labelFor(LIST_TYPES, type, "Danh mục")}
      query={query}
      page={page}
      onPage={setPage}
    />
  );
}
