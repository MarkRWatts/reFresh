import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { renderBrandedEmail, sendEmail } from "@/lib/email";

// Comma-separated, case-insensitive email allowlist — the app-level half of
// the belt-and-braces gate described in DEPLOYMENT.md's "Going public"
// section (Cloudflare Access is the other half, on the external path only).
// Ported from jinglejotter.com's app/auth.ts with one deliberate difference:
// there an empty list means nobody signs in; here empty/unset means the gate
// is OFF, so local dev and a LAN-only deployment work without the var and
// enforcement starts only when .env.docker sets it.
function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.toLowerCase());
}

// Silently no-ops for disallowed emails: the allowlist is authoritative at
// session-creation time anyway (see databaseHooks below), but not sending
// the email at all means a stranger who types some other address into the
// sign-in form never learns this app exists or that they were rejected —
// and never consumes Resend quota.
// Unlike sendMagicLinkEmail, this always sends: the recipient was chosen
// deliberately by an already-signed-in household owner, not typed into a
// public form by an anonymous visitor, so there's no "stranger probing for
// whether this app exists" concern. (The invitee may still hit the
// ALLOWED_EMAILS wall at sign-in time — that's a separate, deliberate gate.)
async function sendInvitationEmail(data: {
  id: string;
  email: string;
  organization: { name: string };
  inviter: { user: { name: string | null; email: string } };
}) {
  const baseUrl = process.env.AUTH_URL ?? "";
  const url = `${baseUrl}/invite/${data.id}`;
  const inviterName = data.inviter.user.name ?? data.inviter.user.email;
  const { html, text } = renderBrandedEmail({
    heading: `${inviterName} invited you to the ${data.organization.name} household`,
    bodyHtml:
      "<p>Join their household on re:Fresh to share the recipe catalog, favourites, and the weekly meal plan.</p>",
    bodyText:
      "Join their household on re:Fresh to share the recipe catalog, favourites, and the weekly meal plan.",
    ctaLabel: "View invite",
    ctaUrl: url,
    footerText:
      "This invite was sent from re:Fresh by a household owner. If you weren't expecting it, you can safely ignore this email.",
  });
  await sendEmail({
    to: data.email,
    subject: `${inviterName} invited you to join ${data.organization.name} on re:Fresh`,
    html,
    text,
  });
}

async function sendMagicLinkEmail(email: string, url: string) {
  if (!isAllowedEmail(email)) return;
  const { html, text } = renderBrandedEmail({
    heading: "Your sign-in link",
    bodyHtml: "<p>Click below to get back into re:Fresh. This link expires in 10 minutes.</p>",
    bodyText: "Click below to get back into re:Fresh. This link expires in 10 minutes.",
    ctaLabel: "Sign in to re:Fresh",
    ctaUrl: url,
  });
  await sendEmail({ to: email, subject: "Your re:Fresh sign-in link", html, text });
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Self-hosted behind a plain reverse proxy, not Vercel — Better Auth
  // needs its own base URL up front (it doesn't infer this from the
  // incoming request the way Auth.js's trustHost does), and an explicit
  // allowlist of origins its CSRF/origin-check middleware will accept.
  baseURL: process.env.AUTH_URL,
  trustedOrigins: (process.env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
  },
  socialProviders: {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    },
  },
  // No dev-seeded User rows exist to link, so accountLinking stays at its
  // default rather than trusting Google to auto-link (see jinglejotter.com's
  // own roadmap note on why that trust is narrower than it looks once
  // sign-in is open beyond a tiny allowlist).
  databaseHooks: {
    // Gate every session creation (i.e. every successful sign-in), not just
    // first-time account creation — fires via the shared internalAdapter
    // createWithHooks path regardless of auth method (Google, magic link,
    // whatever comes next), so a disallowed email can never get a session;
    // at worst it leaves an unusable orphan User row. No-op while
    // ALLOWED_EMAILS is unset — see isAllowedEmail above. Household
    // membership (require-member.ts) remains the gate on reaching any data.
    session: {
      create: {
        async before(session) {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });
          if (!isAllowedEmail(user?.email)) {
            return false;
          }
          return true;
        },
      },
    },
  },
  plugins: [
    // Multi-tenancy scaffolding — renamed to Household/Member/Invitation to
    // match this app's own domain language; underlying plugin behaviour
    // (roles, endpoints) is unchanged. See prisma/schema.prisma.
    organization({
      schema: {
        organization: { modelName: "Household" },
        member: {
          modelName: "Member",
          fields: { organizationId: "householdId" },
        },
        invitation: {
          modelName: "Invitation",
          fields: { organizationId: "householdId" },
        },
        session: {
          fields: { activeOrganizationId: "activeHouseholdId" },
        },
      },
      creatorRole: "owner",
      // One household per user, not the plugin's default multi-org model.
      // organizationLimit only guards the *create* path — the accept-invite
      // path enforces this itself too (see app/actions/household.ts's
      // acceptInvitation).
      organizationLimit: async (user) => {
        const existingMembership = await prisma.member.findFirst({ where: { userId: user.id } });
        return existingMembership !== null;
      },
      // A household's recipes/favourites/plan are the point of the app —
      // never let the plugin's built-in delete-organization endpoint
      // remove one outright.
      disableOrganizationDeletion: true,
      sendInvitationEmail,
    }),
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
    // Required for the server-action sign-in/sign-out pattern used by
    // app/signin/page.tsx and the header's sign-out button — without this,
    // Set-Cookie headers from actions invoked via `auth.api.*` inside a
    // "use server" action don't reach the browser. Must stay last.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
