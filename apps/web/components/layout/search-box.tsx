"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useSearch } from "@/lib/movies";
import { useDebounce } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";

export function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [focused, setFocused] = useState(false);
  const debounced = useDebounce(keyword.trim(), 400);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useSearch(debounced, 1);
  const suggestions = (data?.items ?? []).slice(0, 5);
  const showDropdown = focused && debounced.length > 0;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (kw: string) => {
    const q = kw.trim();
    if (!q) return;
    setFocused(false);
    onNavigate?.();
    router.push(`/tim-kiem?keyword=${encodeURIComponent(q)}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(keyword);
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <form onSubmit={submit} className="relative w-full">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFocused(false);
          }}
          placeholder="Tìm kiếm phim..."
          className="pr-9 pl-9"
          aria-label="Tìm kiếm phim"
        />
        {isFetching && debounced.length > 0 && (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </form>

      {showDropdown && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {suggestions.map((m) => (
            <Link
              key={m.slug}
              href={`/phim/${m.slug}`}
              onClick={() => {
                setFocused(false);
                onNavigate?.();
              }}
              className="flex items-center gap-3 px-3 py-2 hover:bg-muted"
            >
              <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                {(m.poster_url || m.thumb_url) && (
                  <Image
                    src={(m.poster_url || m.thumb_url) as string}
                    alt=""
                    fill
                    sizes="36px"
                    className="object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[m.original_name, m.year].filter(Boolean).join(" · ")}
                </p>
              </div>
            </Link>
          ))}
          <button
            onClick={() => go(keyword)}
            className={cn(
              "w-full cursor-pointer px-3 py-2.5 text-left text-sm font-medium text-brand hover:bg-muted",
            )}
          >
            {suggestions.length > 0
              ? `Xem tất cả kết quả cho "${debounced}"`
              : isFetching
                ? "Đang tìm..."
                : `Tìm "${debounced}"`}
          </button>
        </div>
      )}
    </div>
  );
}
