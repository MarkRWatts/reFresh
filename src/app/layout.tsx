import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
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

function initial(name: string | null | undefined, email: string | null | undefined): string {
  return (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
}

// Every page renders PlanDrawerRoot, which queries the DB — nothing under
// this layout can be statically prerendered (there's no DB at build time).
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Soft check, not requireMemberOrRedirect() — this layout wraps every
  // route including the public /signin and /invite/[token] pages, so it
  // can't unconditionally bounce a signed-out visitor. Each protected page
  // does its own requireMemberOrRedirect(); this just decides what the
  // header itself shows.
  const session = await auth.api.getSession({ headers: await headers() });
  const member = session?.user?.id
    ? await prisma.member.findFirst({ where: { userId: session.user.id } })
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 font-sans text-zinc-900">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-7xl items-center px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <Logo />
              <Image
                src="/brand/wordmark.png"
                alt="HelloFresh re:Mixed"
                width={1895}
                height={271}
                className="h-4 w-auto sm:h-6 md:h-7"
                priority
              />
            </Link>
            <div className="ml-auto flex items-center gap-3">
              {member && <PlanDrawerRoot householdId={member.householdId} />}
              {session?.user ? (
                <Link
                  href="/account"
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-zinc-100"
                >
                  {session.user.image ? (
                    <Image
                      src={session.user.image}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700"
                      aria-hidden="true"
                    >
                      {initial(session.user.name, session.user.email)}
                    </span>
                  )}
                  {/* Name text drops on mobile — just the avatar there, same
                      as the "This week"/sign-out squeeze this was added to
                      fix. Sign out itself lives on /account now, not here. */}
                  <span className="hidden max-w-[8rem] truncate text-sm font-medium text-zinc-700 sm:inline">
                    {session.user.name ?? session.user.email}
                  </span>
                </Link>
              ) : (
                <Link
                  href="/signin"
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:border-zinc-400"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
