"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, mounted, toggle } = useTheme();

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Chuyển chế độ sáng tối"
        disabled
      >
        <span className="size-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"
      }
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
