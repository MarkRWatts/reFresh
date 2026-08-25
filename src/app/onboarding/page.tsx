import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Home, Link2 } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createHousehold, goToInvite } from "@/app/actions/household";
import CreateHouseholdForm from "@/components/CreateHouseholdForm";

// First-run screen for a signed-in user with no household: create one, or
// jump to an invite link they were sent. Reached via requireMemberOrRedirect()
// from every protected page, so a user with a household is never routed
// here in normal use — the redirect below only guards a direct visit.
export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/signin?callbackURL=/onboarding");

  const member = await prisma.member.findFirst({ where: { userId: session.user.id } });
  if (member) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">Welcome to re:Fresh</h1>
          <p className="text-sm text-zinc-500">
            Set up your own household, or join one you&apos;ve been invited to.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <Home size={18} className="text-emerald-600" />
            <h2 className="font-semibold text-zinc-900">Start a new household</h2>
          </div>
          <p className="text-sm text-zinc-500">
            You&apos;ll be its owner, and can invite the rest of your household once it&apos;s
            set up. Everyone shares the same recipe catalog but keeps their own favourites,
            hidden recipes, and this week&apos;s plan.
          </p>
          <CreateHouseholdForm action={createHousehold} />
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          or
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-emerald-600" />
            <h2 className="font-semibold text-zinc-900">Have an invite?</h2>
          </div>
          <form action={goToInvite} className="flex flex-col gap-3">
            <input
              type="text"
              name="invite"
              required
              placeholder="Paste the invite link"
              className="w-full rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
