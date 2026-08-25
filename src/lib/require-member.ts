import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type Member = { userId: string; householdId: string; role: string };

/** Every mutating server action's first call: resolves the signed-in
 *  user's household membership from the session. Single membership is
 *  enforced at create/accept-invite time (see auth.ts's organizationLimit
 *  and acceptInvitation in app/actions/household.ts), so this can safely
 *  assume at most one row. Throws — appropriate for a server action, where
 *  the caller turns a thrown Error into a form error. For page data-loading
 *  use requireMemberOrRedirect() instead. */
export async function requireMember(): Promise<Member> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");

  const member = await prisma.member.findFirst({ where: { userId } });
  if (!member) throw new Error("You're not part of a household yet.");

  return { userId, householdId: member.householdId, role: member.role };
}

/** Page-load variant of requireMember(): redirects instead of throwing.
 *  Not signed in -> /signin; signed in but no household yet -> /onboarding
 *  (create-a-household or jump-to-an-invite, not a dead end). */
export async function requireMemberOrRedirect(): Promise<Member> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) redirect("/signin");

  const member = await prisma.member.findFirst({ where: { userId } });
  if (!member) redirect("/onboarding");

  return { userId, householdId: member.householdId, role: member.role };
}
