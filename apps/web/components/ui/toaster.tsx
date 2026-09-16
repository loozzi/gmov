"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DISMISS_MS = 4000;
// Keep in sync with --animate-toast-out so the node leaves after the exit
// animation instead of popping out.
const EXIT_MS = 180;

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [closing, setClosing] = useState<number[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setClosing((prev) => prev.filter((x) => x !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setClosing((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-72 flex-col gap-2"
      >
        {toasts.map((t) => {
          const isClosing = closing.includes(t.id);
          return (
            <div
              key={t.id}
              onAnimationEnd={() => {
                if (isClosing) remove(t.id);
              }}
              className={cn(
                "border-border bg-card pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-xl",
                isClosing ? "animate-toast-out" : "animate-toast-in",
              )}
            >
              {t.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-400" />
              ) : t.kind === "error" ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
              ) : null}
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Đóng thông báo"
                className={cn(
                  "text-muted-foreground hover:text-foreground cursor-pointer",
                )}
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
