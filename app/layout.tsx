import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AppShell } from "@/components/shared/AppShell";
import { PwaUpdater } from "@/components/shared/PwaUpdater";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Galaxique Beta 2 — Your Unique Universe",
  description:
    "A space-themed personality visualizer where the stars keep small secrets. Answer a short quiz and your inner universe unfolds in 3D, with a song that matches your vibe.",
};

export const viewport: Viewport = {
  themeColor: "#080b1c",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="cosmic-bg min-h-full flex flex-col">
        <PwaUpdater />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
