"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useSearch } from "@/lib/movies";
import { useDebounce } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";

export function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebounce(keyword.trim(), 400);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const { data, isFetching } = useSearch(debounced, 1);
  const suggestions = (data?.items ?? []).slice(0, 5);
  const showDropdown = focused && debounced.length > 0;

  // Reset highlight whenever the suggestion list changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [debounced, data]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const close = () => {
    setFocused(false);
    setActiveIndex(-1);
  };

  const go = (kw: string) => {
    const q = kw.trim();
    if (!q) return;
    close();
    onNavigate?.();
    router.push(`/tim-kiem?keyword=${encodeURIComponent(q)}`);
  };

  const openSuggestion = (index: number) => {
    const m = suggestions[index];
    if (!m) return;
    close();
    onNavigate?.();
    router.push(`/phim/${m.slug}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(keyword);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      // Let the form submit when nothing is highlighted.
      e.preventDefault();
      openSuggestion(activeIndex);
    }
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <form onSubmit={submit} className="relative w-full" role="search">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Tìm kiếm phim..."
          className="pr-9 pl-9"
          aria-label="Tìm kiếm phim"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
        />
        {isFetching && debounced.length > 0 && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
        )}
      </form>

      {showDropdown && (
        <div className="animate-zoom-in border-border bg-card absolute top-full right-0 left-0 z-50 mt-1 origin-top overflow-hidden rounded-xl border shadow-xl">
          <ul role="listbox" id={listId} aria-label="Gợi ý phim">
            {suggestions.map((m, i) => (
              <li
                key={m.slug}
                role="option"
                id={`${listId}-option-${i}`}
                aria-selected={i === activeIndex}
              >
                <Link
                  href={`/phim/${m.slug}`}
                  onClick={() => {
                    close();
                    onNavigate?.();
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "hover:bg-muted flex items-center gap-3 px-3 py-2",
                    i === activeIndex && "bg-muted",
                  )}
                >
                  <div className="bg-muted relative h-12 w-9 shrink-0 overflow-hidden rounded">
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
                    <p className="text-muted-foreground truncate text-xs">
                      {[m.original_name, m.year].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <button
            onClick={() => go(keyword)}
            className={cn(
              "text-brand hover:bg-muted w-full cursor-pointer px-3 py-2.5 text-left text-sm font-medium",
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
