import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { THEME_INIT_SCRIPT } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "gmov — Xem phim",
    template: "%s | gmov",
  },
  description: "Web xem phim: duyệt, tìm kiếm và theo dõi phim yêu thích.",
};

const roboto = Roboto({
  weight: ["400", "500", "700"],
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://phim.nguonc.com" />
        <link rel="dns-prefetch" href="https://phim.nguonc.com" />
      </head>
      <body className={`${roboto.className} flex min-h-screen flex-col antialiased`}>
        <PwaRegister />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
