"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Clapperboard,
  LogIn,
  LogOut,
  Menu,
  Search,
  User,
  UserPlus,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  COUNTRIES,
  GENRES,
  LIST_TYPES,
  YEARS,
  type CatalogEntry,
} from "@/lib/catalog";

function MenuDropdown({
  label,
  base,
  entries,
}: {
  label: string;
  base: string;
  entries: CatalogEntry[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {label}
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 w-52 overflow-y-auto">
        {entries.map((e) => (
          <DropdownMenuItem key={e.slug} asChild>
            <Link href={`${base}/${e.slug}`}>{e.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = keyword.trim();
    if (!q) return;
    onNavigate?.();
    router.push(`/search?keyword=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={submit} className="relative w-full">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Tìm kiếm phim..."
        className="pl-9"
        aria-label="Tìm kiếm phim"
      />
    </form>
  );
}

function AccountMenu() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();

  if (isLoading) {
    return <div className="size-9 animate-pulse rounded-full bg-muted" />;
  }
  if (!isAuthenticated || !user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">
            <LogIn /> Đăng nhập
          </Link>
        </Button>
        <Button size="sm" asChild className="hidden sm:inline-flex">
          <Link href="/register">
            <UserPlus /> Đăng ký
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground"
          aria-label="Tài khoản"
        >
          {user.display_name.charAt(0).toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate">
          {user.display_name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me">
            <User /> Trang cá nhân
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/me/favorites">Phim yêu thích</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void logout();
          }}
        >
          <LogOut /> Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MOBILE_LINKS = [
  { href: "/", label: "Trang chủ" },
  ...LIST_TYPES.map((t) => ({ href: `/list/${t.slug}`, label: t.label })),
];

export function SiteHeader() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Mở menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetTitle>
              <span className="text-lg font-bold">
                g<span className="text-brand">mov</span>
              </span>
            </SheetTitle>
            <div className="mt-2">
              <SearchBox onNavigate={() => setDrawerOpen(false)} />
            </div>
            <nav className="mt-2 flex flex-col gap-1 overflow-y-auto">
              {MOBILE_LINKS.map((l) => (
                <SheetClose key={l.href} asChild>
                  <Link
                    href={l.href}
                    className="rounded-md px-3 py-2 text-sm hover:bg-muted"
                  >
                    {l.label}
                  </Link>
                </SheetClose>
              ))}
              <p className="px-3 pt-3 text-xs text-muted-foreground">Thể loại</p>
              {GENRES.slice(0, 8).map((g) => (
                <SheetClose key={g.slug} asChild>
                  <Link
                    href={`/the-loai/${g.slug}`}
                    className="rounded-md px-3 py-2 text-sm hover:bg-muted"
                  >
                    {g.label}
                  </Link>
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <Clapperboard className="size-6 text-brand" />
          <span>
            g<span className="text-brand">mov</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center lg:flex">
          <MenuDropdown label="Danh mục" base="/list" entries={LIST_TYPES} />
          <MenuDropdown label="Thể loại" base="/the-loai" entries={GENRES} />
          <MenuDropdown label="Quốc gia" base="/quoc-gia" entries={COUNTRIES} />
          <MenuDropdown label="Năm" base="/nam" entries={YEARS} />
        </nav>

        <div className="ml-auto hidden w-64 md:block xl:w-80">
          <SearchBox />
        </div>
        <AccountMenu />
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchBox />
      </div>
    </header>
  );
}
