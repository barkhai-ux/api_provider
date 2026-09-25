import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { connection } from "next/server";
import { AppProviders } from "@/components/providers/app-providers";
import { siteConfig } from "@/lib/config";
import "./globals.css";

// Geometric sans with the Cyrillic glyphs Mongolian needs (Ө, Ү).
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
};

export const viewport: Viewport = {
  themeColor: "#101215",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page is rendered per request so Next.js can put the CSP nonce from
  // proxy.ts on its scripts; a statically built page has no nonce to use.
  await connection();
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <a
          href="#main"
          className="sr-only z-100 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
