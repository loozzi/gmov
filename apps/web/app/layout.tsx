import type { Metadata } from "next";
import "./globals.css";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: {
    default: "gmov — Xem phim",
    template: "%s | gmov",
  },
  description: "Web xem phim: duyệt, tìm kiếm và theo dõi phim yêu thích.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <head>
        <link rel="preconnect" href="https://phim.nguonc.com" />
        <link rel="dns-prefetch" href="https://phim.nguonc.com" />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <PwaRegister />
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
