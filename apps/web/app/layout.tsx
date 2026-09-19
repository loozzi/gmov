import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import { JsonLd } from "@/components/seo/json-ld";
import { THEME_INIT_SCRIPT } from "@/components/theme-provider";
import { TV_INIT_SCRIPT } from "@/lib/tv";
import {
  SITE_DESCRIPTION,
  SITE_LOCALE,
  SITE_NAME,
  siteUrl,
  websiteJsonLd,
} from "@/lib/seo";

const SITE_TITLE = `${SITE_NAME} — Xem phim`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: SITE_LOCALE,
    url: siteUrl(),
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      { url: "/opengraph-image", width: 1200, height: 630, alt: SITE_NAME },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
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
        <script dangerouslySetInnerHTML={{ __html: TV_INIT_SCRIPT }} />
        <JsonLd data={websiteJsonLd()} />
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
