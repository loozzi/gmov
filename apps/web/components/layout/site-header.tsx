"use client";

import Link from "next/link";
import {
  Bookmark,
  ChevronDown,
  Clapperboard,
  Heart,
  LogIn,
  LogOut,
  Menu,
  ShieldCheck,
  User,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { SearchBox } from "@/components/layout/search-box";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";

function MenuDropdown({
  label,
  base,
  entries,
  columns = 1,
}: {
  label: string;
  base: string;
  entries: CatalogEntry[];
  columns?: 1 | 3;
}) {
  // Hover opens the popup; a short close delay lets the pointer cross the gap
  // into the portalled content (which cancels the close on enter). Keyboard and
  // touch keep working: Radix still toggles on keydown, and mouse pointerdown
  // is suppressed so clicking a hovered trigger does not close it.
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const handleEnter = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const handleLeave = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  // Long catalogs (genres/countries/years) lay out in 3 columns so every entry
  // is visible at once instead of a tall scrolling list.
  const contentClass =
    columns === 3
      ? "grid w-[30rem] grid-cols-3 gap-x-1 p-1.5"
      : "max-h-80 w-52 overflow-y-auto";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex cursor-pointer items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") e.preventDefault();
          }}
        >
          {label}
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={contentClass}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {entries.map((e) => (
          <DropdownMenuItem key={e.slug} asChild className="whitespace-nowrap">
            <Link href={`${base}/${e.slug}`}>{e.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu() {
  const { user, isLoading, isAuthenticated, isModerator, logout } = useAuth();

  if (isLoading) {
    return <div className="bg-muted size-9 animate-pulse rounded-full" />;
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
    <div className="flex items-center gap-1">
      <ProfileMenu />
      {/* modal={false}: same reason as the nav menu — a transient menu must not
          hide the viewport scrollbar (it made the page flicker). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            className="bg-brand text-brand-foreground flex size-9 cursor-pointer items-center justify-center rounded-full text-sm font-bold"
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
            <Link href="/me/favorites">
              <Heart /> Phim yêu thích
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/me/watchlist">
              <Bookmark /> Muốn xem
            </Link>
          </DropdownMenuItem>
          {isModerator && (
            <DropdownMenuItem asChild>
              <Link href="/admin/reports">
                <ShieldCheck /> Quản trị
              </Link>
            </DropdownMenuItem>
          )}
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
    </div>
  );
}

const MOBILE_LINKS = [
  { href: "/", label: "Trang chủ" },
  ...LIST_TYPES.map((t) => ({ href: `/list/${t.slug}`, label: t.label })),
];

export function SiteHeader() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "border-border bg-background/90 sticky top-0 z-40 border-b backdrop-blur transition-shadow duration-200",
        scrolled && "shadow-lg shadow-black/5 dark:shadow-black/40",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Mở menu"
            >
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
                    className="hover:bg-muted rounded-md px-3 py-2 text-sm"
                  >
                    {l.label}
                  </Link>
                </SheetClose>
              ))}
              <p className="text-muted-foreground px-3 pt-3 text-xs">
                Thể loại
              </p>
              {GENRES.slice(0, 8).map((g) => (
                <SheetClose key={g.slug} asChild>
                  <Link
                    href={`/the-loai/${g.slug}`}
                    className="hover:bg-muted rounded-md px-3 py-2 text-sm"
                  >
                    {g.label}
                  </Link>
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <Clapperboard className="text-brand size-6" />
          <span>
            g<span className="text-brand">mov</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center lg:flex">
          <MenuDropdown label="Danh mục" base="/list" entries={LIST_TYPES} />
          <MenuDropdown
            label="Thể loại"
            base="/the-loai"
            entries={GENRES}
            columns={3}
          />
          <MenuDropdown
            label="Quốc gia"
            base="/quoc-gia"
            entries={COUNTRIES}
            columns={3}
          />
          <MenuDropdown label="Năm" base="/nam" entries={YEARS} columns={3} />
        </nav>

        <div className="ml-auto hidden w-64 md:block xl:w-80">
          <SearchBox />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchBox />
      </div>
    </header>
  );
}
