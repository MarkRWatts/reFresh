import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Logo from "@/components/Logo";
import PlanDrawerRoot from "@/components/PlanDrawerRoot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "re:Fresh",
  description: "Browse HelloFresh recipes and plan a week that shares ingredients, not waste.",
};

// Every page renders PlanDrawerRoot, which queries the DB — nothing under
// this layout can be statically prerendered (there's no DB at build time).
export const dynamic = "force-dynamic";

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
      <body className="min-h-full flex flex-col bg-zinc-50 font-sans text-zinc-900">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-7xl items-center px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Logo className="h-6 w-6" />
              re<span className="text-emerald-600">:</span>Fresh
            </Link>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <div className="print:hidden">
          <PlanDrawerRoot />
        </div>
      </body>
    </html>
  );
}
