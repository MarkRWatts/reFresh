import Link from "next/link";
import { headers } from "next/headers";
import { UtensilsCrossed } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { acceptInvitation } from "@/app/actions/household";
import SubmitButton from "@/components/SubmitButton";

// Public-ish landing page for an invite link — allowlisted in proxy.ts.
// Not gated by household membership: anyone holding the (unguessable)
// token URL can see the preview; only a signed-in user can actually
// accept. Redemption is token-only, not email-matched — see
// app/actions/household.ts's acceptInvitation.
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invitation = await prisma.invitation.findUnique({
    where: { id: token },
    include: {
      household: { select: { name: true } },
      inviter: { select: { name: true, email: true } },
    },
  });

  const invalid =
    !invitation || invitation.status !== "pending" || invitation.expiresAt < new Date();

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center">
        <UtensilsCrossed size={32} className="text-emerald-600" />

        {invalid ? (
          <>
            <h1 className="text-2xl font-semibold text-zinc-900">This invite isn&apos;t valid</h1>
            <p className="text-sm text-zinc-500">
              It may have expired, already been used, or been cancelled — ask whoever invited you
              for a fresh link.
            </p>
            <Link
              href="/"
              className="rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Go to re:Fresh
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-zinc-900">Join {invitation.household.name}</h1>
            <p className="text-sm text-zinc-500">
              {invitation.inviter.name ?? invitation.inviter.email} invited you to share their
              recipe catalog, favourites, and meal plan on re:Fresh.
            </p>

            {error === "already-in-household" ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                You&apos;re already part of a different household — leave it first before joining
                this one.
              </p>
            ) : error === "already-member" ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                You&apos;re already part of this household.
              </p>
            ) : error === "invalid" ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                That invite is no longer valid.
              </p>
            ) : null}

            {session?.user ? (
              <form action={acceptInvitation} className="w-full">
                <input type="hidden" name="token" value={token} />
                <SubmitButton
                  label={`Join ${invitation.household.name}`}
                  pendingLabel="Joining…"
                  className="flex w-full items-center justify-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                />
              </form>
            ) : (
              <Link
                href={`/signin?callbackURL=${encodeURIComponent(`/invite/${token}`)}`}
                className="w-full rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Sign in to accept
              </Link>
            )}
          </>
        )}
      </div>
    </main>
  );
}
