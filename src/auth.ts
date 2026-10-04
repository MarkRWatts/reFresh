import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP, genericOAuth, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { renderBrandedEmail, sendEmail } from "@/lib/email";
import { isAllowedEmail } from "@/lib/allowed-email";
import { sendSignInOTP } from "@/lib/otp-email";
import {
  NO_ACCESS_ERROR,
  POCKET_ID_PROVIDER_ID,
  REQUIRED_GROUP,
  hasRequiredGroup,
  pocketIdConfig,
} from "@/lib/auth/pocket-id";

// Three ways in, all reaching the same User row, and the same three as
// MediaVault and jinglejotter.com:
//
//   - an emailed six-digit code (emailOTP), matched to the User by email.
//     Replaced the magic link: an installed iOS home-screen app has its own
//     cookie jar, so a link tapped in Mail signed Safari in, not the app.
//   - a passkey registered on /account, bound to that User's row.
//   - Pocket ID (home network only), linked to the User by email on first
//     use, and only for members of its `refresh` group.
//
// Google sign-in was retired 2026-10: its Account rows stay in the database
// as harmless residue; the same people now sign in by email code, matched by
// email.
//
// Every method then passes the same gates: ALLOWED_EMAILS on every session
// (databaseHooks below), household membership on every page
// (src/lib/require-member.ts), and invitations for joining a household.

type Env = Record<string, string | undefined>;

// Unlike the sign-in code email (src/lib/otp-email.ts), this always sends:
// the recipient was chosen deliberately by an already-signed-in household
// owner, not typed into a public form by an anonymous visitor, so there's no
// "stranger probing for whether this app exists" concern. (The invitee may
// still hit the ALLOWED_EMAILS wall at sign-in time — that's a separate,
// deliberate gate.)
export async function sendInvitationEmail(data: {
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

/**
 * The Pocket ID group gate. Better Auth runs this at every point a provider
 * sign-in can get through — before creating a new user (`create-user`),
 * before linking Pocket ID to an existing user (`link-account`), and on every
 * later Pocket ID sign-in (`sign-in`) — with the provider's fresh claims,
 * before any session exists. A refusal sends the browser back to
 * /signin?error=no_access; one at `create-user` means a stranger never
 * leaves even a bare User row.
 *
 * Email-code and passkey sign-ins aren't Pocket ID's business and pass
 * straight through (ALLOWED_EMAILS still gates them, in the session hook).
 */
export const validateUserInfo: NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]> = ({
  source,
}) => {
  if (source.method !== "oauth" || source.oauth?.providerId !== POCKET_ID_PROVIDER_ID) return;
  if (!hasRequiredGroup(source.oauth.profile)) {
    return {
      error: NO_ACCESS_ERROR,
      errorDescription: `Not in the Pocket ID group ${REQUIRED_GROUP}.`,
    };
  }
};

/** The passkey relying party: this app's own origin from AUTH_URL
 *  (https://refresh.markrwatts.com in production, http://localhost:3000 in
 *  dev), never the request's Origin header, which is the plugin's default.
 *  Trailing slash stripped: the plugin is explicit it must not have one, and
 *  .env files are hand-edited. */
export function passkeyRelyingParty(env: Env = process.env): { rpID: string; origin: string | null } {
  const origin = env.AUTH_URL?.trim().replace(/\/$/, "") || null;
  return { rpID: origin ? new URL(origin).hostname : "localhost", origin };
}

export function createAuth(database: BetterAuthOptions["database"], env: Env = process.env) {
  const pocketId = pocketIdConfig(env);
  // The instance's own context, for the session hook below; a thunk because
  // the instance doesn't exist yet while its options are being written.
  const authContext = () => instance.$context;

  const instance = betterAuth({
    database,
    // Self-hosted behind a plain reverse proxy, not Vercel — Better Auth
    // needs its own base URL up front (it doesn't infer this from the
    // incoming request the way Auth.js's trustHost does), and an explicit
    // allowlist of origins its CSRF/origin-check middleware will accept.
    baseURL: env.AUTH_URL,
    trustedOrigins: (env.AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
    },
    advanced: {
      ipAddress: {
        // Rate limiting keys on the client IP. Through the tunnel that's
        // `cf-connecting-ip`, set by Cloudflare's edge and not overridable
        // by the client; the default (`x-forwarded-for` alone) is
        // multi-valued there (Cloudflare and Caddy both append), which
        // Better Auth refuses as untrustworthy, collapsing every visitor
        // into one shared bucket. `x-forwarded-for` stays as the fallback
        // for the LAN path through Caddy. Same as MediaVault.
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    user: { validateUserInfo },
    account: {
      // A first Pocket ID sign-in lands on the existing User with the same
      // email rather than a new one. Safe to trust Pocket ID's email: every
      // account there is created by Ansible with a verified address its
      // owner can't change (only an admin can). Better Auth also requires
      // the existing row's emailVerified, which every email-code, magic-link
      // and Google sign-in has set. No other provider is trusted, and no
      // other provider exists.
      accountLinking: { enabled: true, trustedProviders: [POCKET_ID_PROVIDER_ID] },
    },
    databaseHooks: {
      // Gate every session creation (i.e. every successful sign-in), not
      // just first-time account creation — fires via the shared
      // internalAdapter.createSession path for every method (email code,
      // passkey, Pocket ID), so a disallowed email can never get a session;
      // at worst it leaves an unusable orphan User row. No-op while
      // ALLOWED_EMAILS is unset — see src/lib/allowed-email.ts. Household
      // membership (require-member.ts) remains the gate on reaching any data.
      session: {
        create: {
          async before(session): Promise<boolean> {
            // Through Better Auth's own adapter rather than Prisma directly,
            // so the tests can run this exact hook on an in-memory database.
            const { internalAdapter } = await authContext();
            const user: { email?: string | null } | null = await internalAdapter.findUserById(session.userId);
            return isAllowedEmail(user?.email, env);
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
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10, // 10 minutes, matching the old magic-link window
        allowedAttempts: 3,
        // Sign-up by code is allowed, as the magic link allowed it: a new
        // email gets a User row on its first sign-in, then /onboarding.
        // ALLOWED_EMAILS is enforced twice independently — sendSignInOTP
        // silently doesn't email a refused address, and the session hook
        // above refuses the session whatever the method.
        disableSignUp: false,
        // Hash the code at rest: the default keeps it in plaintext in the
        // Verification table for its 10-minute life, so a database backup
        // taken in that window would hold a usable sign-in code.
        storeOTP: "hashed",
        sendVerificationOTP: sendSignInOTP,
      }),
      // Passkeys: a second way in for existing accounts, never a way to
      // create one. Registration needs a signed-in, fresh (< 24h) session,
      // and sign-in creates its session through the same
      // internalAdapter.createSession every other method uses, so the
      // ALLOWED_EMAILS hook above gates it with no extra code.
      passkey({
        rpName: "re:Fresh",
        ...passkeyRelyingParty(env),
        authenticatorSelection: {
          // Discoverable credentials: sign-in is username-less (the
          // authenticator offers the passkeys it holds for this RP ID),
          // which is what makes one-tap sign-in and browser autofill work.
          residentKey: "required",
          userVerification: "preferred",
        },
      }),
      // Pocket ID, only when POCKET_ID_CLIENT_ID/SECRET are both set, so
      // local dev works without it. Callback:
      // <AUTH_URL>/api/auth/callback/pocket-id (Better Auth 1.7 serves
      // genericOAuth providers on the social callback route).
      genericOAuth({ config: pocketId ? [pocketId] : [] }),
      // Required for the server-action sign-in/sign-out pattern used by
      // app/signin and the header's sign-out button — without this,
      // Set-Cookie headers from actions invoked via `auth.api.*` inside a
      // "use server" action don't reach the browser. Must stay last.
      nextCookies(),
    ],
  });
  return instance;
}

export const auth = createAuth(prismaAdapter(prisma, { provider: "postgresql" }));

export type Session = typeof auth.$Infer.Session;
