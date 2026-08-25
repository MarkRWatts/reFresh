"use server";

// Server actions for households: onboarding (create one, or jump to an
// invite), membership (inviting people in, cancelling pending invites),
// and redeeming an invite. Invitation redemption is token-only (the
// invitation's own id doubles as the bearer token), not email-matched —
// same design as jinglejotter.com's Multi-Tenancy Migration.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/require-member";
import { slugify } from "@/lib/recipes/slug";
import { isTooLong } from "@/lib/validation";
import { sendAppInviteEmail } from "@/lib/email";

export type ActionState = { error?: string; sent?: string } | null;

/** First-run: create a brand-new household for the signed-in user, who
 *  becomes its owner. Delegates to Better Auth's create-organization
 *  endpoint, which enforces the same single-household-per-user check as
 *  invite acceptance (auth.ts's organizationLimit) and assigns
 *  creatorRole ("owner"). */
export async function createHousehold(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/signin?callbackURL=/onboarding");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your household a name." };
  if (isTooLong(name, 60)) return { error: "That name is a bit long." };

  try {
    // Slug suffixed with a timestamp rather than bare slugify(name) — user-
    // chosen names collide far more easily than the old auto-derived ones
    // (two households both landing on "Smith Family" isn't a stretch), and
    // Household.slug is unique.
    await auth.api.createOrganization({
      headers: await headers(),
      body: { name, slug: slugify(`${name}-${Date.now()}`) },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't create that household." };
  }

  // The root layout's header (This week badge, account/sign-in state) is
  // computed once per shared-layout navigation, not on every soft
  // client-side transition — without this, redirecting straight to "/"
  // right after gaining a household shows a stale header (no badge) until
  // a hard reload. Same reason every mutating action in mealplan/actions.ts
  // already does this before its own redirect.
  revalidatePath("/", "layout");
  redirect("/");
}

/** Rename the household — owner-only. Delegates to Better Auth's own
 *  update-organization endpoint, which checks the caller holds
 *  organization:update permission (owner-only by default — see auth.ts;
 *  the "member" role has no organization permissions at all) and scopes
 *  the update to the given organizationId itself, so there's no separate
 *  cross-household check needed here. */
export async function updateHouseholdName(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { householdId } = await requireMember();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your household a name." };
  if (isTooLong(name, 60)) return { error: "That name is a bit long." };

  try {
    await auth.api.updateOrganization({
      headers: await headers(),
      body: { organizationId: householdId, data: { name } },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't rename your household." };
  }

  revalidatePath("/account");
  return null;
}

/** First-run: jump straight to an invite's landing page from a pasted
 *  link or bare token, rather than making someone paste just the id. */
export async function goToInvite(formData: FormData): Promise<void> {
  const raw = String(formData.get("invite") ?? "").trim();
  if (!raw) redirect("/onboarding");

  const marker = "/invite/";
  const markerIndex = raw.indexOf(marker);
  const token = markerIndex >= 0 ? raw.slice(markerIndex + marker.length) : raw;
  const cleanToken = token.split(/[?#]/)[0].trim();

  redirect(`/invite/${encodeURIComponent(cleanToken)}`);
}

/** Invite someone by email — two similar but distinct actions behind one
 *  form, chosen by the form's "appOnly" tickbox:
 *
 *  - Household invite (default): delegates to Better Auth's own
 *    create-invitation endpoint, which checks the caller actually holds
 *    invitation:create permission (owner-only by default — see auth.ts) and
 *    enforces the household's membership limit. The email is a hint shown in
 *    the invite UI, not an authorization check — see acceptInvitation.
 *    auth.ts's sendInvitationEmail emails them a join link.
 *  - App-only invite ("appOnly" set): just sends the branded
 *    come-try-re:Fresh email (lib/email.ts's sendAppInviteEmail). No
 *    Invitation row, nothing to accept, and the recipient never sees this
 *    household — they set up their own via /onboarding. */
export async function createInvitation(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId, householdId } = await requireMember();

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an email address." };
  if (isTooLong(email)) return { error: "That email address is too long." };

  if (formData.get("appOnly")) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    try {
      await sendAppInviteEmail({
        to: email,
        inviterName: user.name ?? user.email ?? "Someone",
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't send that invite." };
    }
    return { sent: email };
  }

  try {
    await auth.api.createInvitation({
      headers: await headers(),
      body: { organizationId: householdId, email, role: "member" },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't send that invite." };
  }

  revalidatePath("/account");
  return null;
}

/** Revoke a pending invite. */
export async function cancelInvitation(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireMember();

  const invitationId = String(formData.get("invitationId") ?? "").trim();
  if (!invitationId) return { error: "Missing invite." };

  try {
    await auth.api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't cancel that invite." };
  }

  revalidatePath("/account");
  return null;
}

/** Redeem an invite by token — the invitation's own id doubles as the
 *  bearer token. Deliberately bypasses Better Auth's own acceptInvitation
 *  endpoint, which requires the invitee's email to match the invitation's
 *  — this app's invites are redeemed by token alone. Single-household-
 *  per-user is enforced here, not by the plugin (which allows multi-org
 *  membership by default). */
export async function acceptInvitation(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/");

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) redirect(`/signin?callbackURL=${encodeURIComponent(`/invite/${token}`)}`);

  const invitation = await prisma.invitation.findUnique({ where: { id: token } });
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    redirect(`/invite/${token}?error=invalid`);
  }

  const existingMembership = await prisma.member.findFirst({ where: { userId } });
  if (existingMembership) {
    redirect(
      `/invite/${token}?error=${
        existingMembership.householdId === invitation.householdId
          ? "already-member"
          : "already-in-household"
      }`,
    );
  }

  await prisma.$transaction([
    prisma.member.create({
      data: { householdId: invitation.householdId, userId, role: invitation.role ?? "member" },
    }),
    prisma.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } }),
  ]);

  // See createHousehold's comment above — same stale-header risk right
  // after gaining household membership.
  revalidatePath("/", "layout");
  redirect("/");
}

/** Promote a plain member to a second owner. Delegates to Better Auth's
 *  own update-member-role endpoint, which checks the caller holds
 *  member:update permission (owner-only by default) and refuses to touch a
 *  member outside the caller's own household. */
export async function promoteToOwner(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { householdId } = await requireMember();

  const memberId = String(formData.get("memberId") ?? "").trim();
  if (!memberId) return { error: "Missing member." };

  try {
    await auth.api.updateMemberRole({
      headers: await headers(),
      body: { organizationId: householdId, memberId, role: "owner" },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't promote that member." };
  }

  revalidatePath("/account");
  return null;
}

/** Demote an owner back to a plain member. */
export async function demoteToMember(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { householdId } = await requireMember();

  const memberId = String(formData.get("memberId") ?? "").trim();
  if (!memberId) return { error: "Missing member." };

  try {
    await auth.api.updateMemberRole({
      headers: await headers(),
      body: { organizationId: householdId, memberId, role: "member" },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't demote that member." };
  }

  revalidatePath("/account");
  return null;
}

/** Remove someone from the household — revokes access only. Every
 *  favourite/hidden/plan row belongs to the household, not to whichever
 *  member set it, so nothing about that state is touched. Delegates the
 *  actual removal to Better Auth's own remove-member endpoint (owner-only
 *  by permission, and it already refuses to remove the household's last
 *  remaining owner). */
export async function removeMember(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { householdId } = await requireMember();

  const memberId = String(formData.get("memberId") ?? "").trim();
  if (!memberId) return { error: "Missing member." };

  const target = await prisma.member.findFirst({ where: { id: memberId, householdId } });
  if (!target) return { error: "That member wasn't found." };

  try {
    await auth.api.removeMember({
      headers: await headers(),
      body: { organizationId: householdId, memberIdOrEmail: memberId },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't remove that member." };
  }

  revalidatePath("/account");
  return null;
}
