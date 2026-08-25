import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { renderBrandedEmail, sendEmail } from "@/lib/email";

async function sendMagicLinkEmail(email: string, url: string) {
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
  // Sign-in is fully open (no email allowlist, unlike jinglejotter.com's
  // two-person gate) — household membership is the real gate on doing
  // anything (see require-member.ts), matching the goal of letting
  // arbitrary future households share the recipe catalog. No dev-seeded
  // User rows exist to link either, so accountLinking stays at its default
  // rather than trusting Google to auto-link (see jinglejotter.com's own
  // roadmap note on why that trust is narrower than it looks once sign-in
  // is open to more than a two-address allowlist).
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
