"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toVietnameseMessage } from "@/lib/errors";

const registerSchema = z
  .object({
    email: z.string().email("Email chưa đúng định dạng."),
    username: z
      .string()
      .min(3, "Tên đăng nhập cần ít nhất 3 ký tự.")
      .max(32, "Tên đăng nhập tối đa 32 ký tự.")
      .regex(
        /^[a-zA-Z0-9_.]+$/,
        "Tên đăng nhập chỉ gồm chữ, số, dấu chấm và gạch dưới.",
      ),
    password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự."),
    confirm: z.string().min(1, "Vui lòng nhập lại mật khẩu."),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Mật khẩu nhập lại chưa khớp.",
    path: ["confirm"],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: signUp } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterForm) => {
    setServerError(null);
    try {
      await signUp(values.email.trim(), values.username.trim(), values.password);
      router.push("/");
      router.refresh();
    } catch (e) {
      setServerError(toVietnameseMessage(e));
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-8">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Tạo tài khoản</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Miễn phí, chỉ mất chưa tới một phút
          </p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="ban@example.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-red-400">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm font-medium">
              Tên đăng nhập
            </label>
            <Input
              id="username"
              autoComplete="username"
              placeholder="ten_cua_ban"
              {...register("username")}
            />
            {errors.username && (
              <p className="text-xs text-red-400">{errors.username.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Mật khẩu
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Ít nhất 8 ký tự"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-400">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm" className="text-sm font-medium">
              Nhập lại mật khẩu
            </label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              {...register("confirm")}
            />
            {errors.confirm && (
              <p className="text-xs text-red-400">{errors.confirm.message}</p>
            )}
          </div>
          {serverError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {serverError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Đang tạo tài khoản..." : "Đăng ký"}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  );
}
