"use server";

// Self-service account deletion. Separate from household.ts (which is
// about managing a household you're staying in) — this is the caller
// permanently deleting their own User row.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type ActionState = { error?: string } | null;

/** Permanently delete the signed-in user's own account.
 *
 *  A plain member (or an owner with a co-owner already in place) can
 *  always delete their account outright — schema.prisma's cascades take
 *  their Session, Account, Member, and any Invitations they sent along
 *  with them; the household itself and everything in it (favourites,
 *  hidden recipes, this week's plan) is untouched, exactly like
 *  removeMember.
 *
 *  An owner with no co-owner is different: this app has no "ownerless
 *  household" state, so there's nowhere for the household to go. That
 *  path requires typing the household's exact name to confirm — deleting
 *  your account there deletes the whole household for everyone in it,
 *  not just your own access. schema.prisma cascades Household deletion
 *  down through Member/Invitation/MealPlan(+MealPlanRecipe)/
 *  HouseholdRecipeState on its own, so a single `household.delete()`
 *  covers it — no manual per-table cleanup needed (unlike a household
 *  model with non-cascading children).
 *
 *  Bypasses Better Auth's own /delete-user endpoint (same reasoning as
 *  acceptInvitation bypassing /organization/accept-invitation): that
 *  endpoint assumes a password-based flow (requires either a password or
 *  a "fresh" session before it'll proceed), which doesn't fit an app
 *  that's Google/magic-link only and has no password to check.
 */
export async function deleteAccount(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const member = await prisma.member.findFirst({ where: { userId } });

  if (member?.role === "owner") {
    const otherOwners = await prisma.member.count({
      where: { householdId: member.householdId, role: "owner", userId: { not: userId } },
    });

    if (otherOwners === 0) {
      const household = await prisma.household.findUniqueOrThrow({
        where: { id: member.householdId },
      });
      const confirmName = String(formData.get("confirmHouseholdName") ?? "").trim();
      if (confirmName !== household.name) {
        return {
          error: `You're the only owner of "${household.name}" — deleting your account deletes the whole household. Type its name exactly to confirm, or promote another member to owner first and come back.`,
        };
      }

      await prisma.household.delete({ where: { id: household.id } });
    }
  }

  // Sign out first, while the Session row this cookie points at still
  // exists — auth.api.signOut() clears the cookie via the response
  // headers correctly (naming/signing details this app shouldn't
  // reimplement by hand). Deleting the User row after cascades the
  // Session away too, but that's just a second, redundant removal by then.
  await auth.api.signOut({ headers: await headers() });
  await prisma.user.delete({ where: { id: userId } });
  redirect("/signin?deleted=1");
}
