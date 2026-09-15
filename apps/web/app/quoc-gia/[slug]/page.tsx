"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

import { MovieGrid } from "@/components/movies/movie-grid";
import { COUNTRIES, labelFor } from "@/lib/catalog";
import { useCountry } from "@/lib/movies";

export default function CountryPage() {
  const params = useParams<{ slug: string }>();
  const [page, setPage] = useState(1);
  const query = useCountry(params.slug, page);

  return (
    <MovieGrid
      title={`Quốc gia: ${labelFor(COUNTRIES, params.slug, params.slug)}`}
      query={query}
      page={page}
      onPage={setPage}
    />
  );
}
