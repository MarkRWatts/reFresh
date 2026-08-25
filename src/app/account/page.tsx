import Image from "next/image";
import { CircleUserRound, Home, Mail, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireMemberOrRedirect } from "@/lib/require-member";
import SignOutButton from "@/components/SignOutButton";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import RenameHouseholdForm from "@/components/RenameHouseholdForm";
import {
  InviteForm,
  PendingInviteRow,
  PromoteButton,
  DemoteButton,
  RemoveMemberButton,
} from "@/components/HouseholdMemberActions";

function initial(name: string | null, email: string | null): string {
  return (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
}

export default async function AccountPage() {
  const { userId, householdId, role } = await requireMemberOrRedirect();
  const isOwner = role === "owner";

  const [user, household] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    // The household name and member list are visible to every member, not
    // just owners — only the pending-invitations query (and the invite/
    // manage UI below) is owner-only.
    prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        },
        invitations: isOwner
          ? { where: { status: "pending" }, orderBy: { createdAt: "desc" } }
          : false,
      },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center gap-2">
        <CircleUserRound size={22} className="text-emerald-600" />
        <h1 className="text-2xl font-semibold text-zinc-900">Account</h1>
      </header>

      <section className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl font-semibold text-emerald-700"
            aria-hidden="true"
          >
            {initial(user.name, user.email)}
          </span>
        )}
        <div className="flex flex-col">
          <span className="text-base font-semibold text-zinc-900">{user.name ?? "No name set"}</span>
          {user.email && <span className="text-sm text-zinc-500">{user.email}</span>}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Home size={20} className="text-emerald-600" />
          {isOwner ? (
            <RenameHouseholdForm name={household.name} />
          ) : (
            <h2 className="text-xl font-semibold text-zinc-900">{household.name}</h2>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Users size={18} className="text-emerald-600" />
          <h3 className="text-lg font-semibold text-zinc-900">Members</h3>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
          {household.members.map((member) => {
            const name = member.user.name ?? member.user.email ?? "This member";
            const canManage = isOwner && member.userId !== userId;
            return (
              <div key={member.id} className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-zinc-900">
                    {name}
                    {member.userId === userId && (
                      <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>
                    )}
                  </span>
                  {member.user.email && (
                    <span className="text-xs text-zinc-400">{member.user.email}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    {member.role}
                  </span>
                  {canManage &&
                    (member.role === "owner" ? (
                      <DemoteButton memberId={member.id} />
                    ) : (
                      <>
                        <PromoteButton memberId={member.id} />
                        <RemoveMemberButton memberId={member.id} />
                      </>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isOwner && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Mail size={20} className="text-emerald-600" />
            <h2 className="text-xl font-semibold text-zinc-900">Invite someone</h2>
          </div>
          <p className="text-sm text-zinc-500">
            Send them the link and they can join with any sign-in method — it doesn&apos;t need to
            match the email you enter here.
          </p>
          <InviteForm />

          {household.invitations && household.invitations.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
              {household.invitations.map((invitation) => (
                <PendingInviteRow
                  key={invitation.id}
                  id={invitation.id}
                  email={invitation.email}
                  expiresAt={invitation.expiresAt.toISOString()}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <SignOutButton />

      <div className="flex justify-center border-t border-zinc-200 pt-6">
        <DeleteAccountButton
          householdName={household.name}
          soleOwner={
            isOwner && !household.members.some((m) => m.userId !== userId && m.role === "owner")
          }
          otherMemberCount={household.members.filter((m) => m.userId !== userId).length}
        />
      </div>
    </div>
  );
}
