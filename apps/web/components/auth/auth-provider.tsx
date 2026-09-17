"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch, setAccessToken } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { requestProfilePicker } from "@/lib/profile-picker";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isModerator: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string,
    website?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User> {
  return apiFetch<User>("/api/v1/users/me");
}

// Module-level boot handshake shared by every AuthProvider mount in this JS
// context. Without it, StrictMode double-mounts (dev) or overlapping mounts
// fire two silent refreshes with the SAME cookie concurrently — rotation
// revokes the token for the loser and wipes a perfectly valid session.
let bootPromise: Promise<{ access_token: string } | null> | null = null;

function bootOnce(): Promise<{ access_token: string } | null> {
  if (!bootPromise) {
    bootPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (!res.ok) return null;
        return (await res.json()) as { access_token: string };
      } catch {
        return null;
      } finally {
        bootPromise = null;
      }
    })();
  }
  return bootPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await bootOnce();
      if (cancelled) return;
      if (data) {
        setAccessToken(data.access_token);
        try {
          const me = await fetchMe();
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) setAccessToken(null);
        }
      } else {
        setAccessToken(null);
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const code =
        typeof body?.code === "string" ? body.code : "INVALID_CREDENTIALS";
      throw new ApiError(res.status, code, "Thông tin đăng nhập không đúng.");
    }
    const data = (await res.json()) as { access_token: string };
    setAccessToken(data.access_token);
    setUser(await fetchMe());
    // Ask the picker to appear once per login/register in this tab. The gate
    // self-gates on >=2 profiles; this only carries the intent.
    requestProfilePicker();
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string, website?: string) => {
      await apiFetch("/api/v1/auth/register", {
        auth: false,
        method: "POST",
        body: JSON.stringify({ email, username, password, website: website ?? null }),
      });
      await login(username, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      isModerator: user?.role === "moderator" || user?.role === "admin",
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
    }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
