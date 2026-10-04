import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";

// Pocket ID: the home lab's passkey identity provider (OIDC), on the LAN and
// VPN only. One of three ways into re:Fresh, alongside an emailed code and a
// passkey registered here; all three reach the same User row (see
// src/auth.ts). Pattern shared with jobAppTracker's src/lib/auth/pocket-id.ts.

export const POCKET_ID_PROVIDER_ID = "pocket-id";
export const POCKET_ID_ISSUER = "https://id.markrwatts.com";
// From Pocket ID's discovery document; only used when the ID token lacks a claim.
const POCKET_ID_USERINFO_URL = `${POCKET_ID_ISSUER}/api/oidc/userinfo`;

/** The Pocket ID group a Pocket ID sign-in must carry (Mark and Emma). Only
 *  gates Pocket ID: email-code and passkey sign-ins don't need it. */
export const REQUIRED_GROUP = "refresh";

/** The `?error=` code /signin gets when a Pocket ID sign-in is refused for not being in REQUIRED_GROUP. */
export const NO_ACCESS_ERROR = "no_access";

type Env = Record<string, string | undefined>;

/** The Pocket ID provider, or null when POCKET_ID_CLIENT_ID and
 *  POCKET_ID_CLIENT_SECRET aren't both set: Pocket ID is optional, so local
 *  dev (and any deployment without it) just doesn't offer it. */
export function pocketIdConfig(env: Env = process.env): GenericOAuthConfig | null {
  const clientId = env.POCKET_ID_CLIENT_ID?.trim();
  const clientSecret = env.POCKET_ID_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    providerId: POCKET_ID_PROVIDER_ID,
    name: "Pocket ID",
    discoveryUrl: `${POCKET_ID_ISSUER}/.well-known/openid-configuration`,
    clientId,
    clientSecret,
    scopes: ["openid", "email", "profile", "groups"],
    // S256: better-auth's only PKCE method.
    pkce: true,
    getUserInfo: (tokens) => getPocketIdUserInfo(tokens),
  };
}

/** True only if the provider profile (ID token / userinfo claims) lists
 *  REQUIRED_GROUP in its `groups` claim; a missing or malformed claim is a no. */
export function hasRequiredGroup(profile: Record<string, unknown> | null | undefined): boolean {
  const groups = profile?.groups;
  return Array.isArray(groups) && groups.includes(REQUIRED_GROUP);
}

type Claims = Record<string, unknown>;

function decodeJwtPayload(jwt: string): Claims | null {
  try {
    const payload: unknown = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? (payload as Claims) : null;
  } catch {
    return null;
  }
}

/**
 * The profile a Pocket ID sign-in proceeds with, and the raw profile
 * src/auth.ts's validateUserInfo checks the groups claim on. Better Auth's
 * genericOAuth has already verified the ID token (signature against Pocket
 * ID's JWKS, issuer, audience, nonce) before calling this. Its own default
 * would take the ID token's claims alone whenever they include an email, so
 * if Pocket ID ever left `groups` out of the ID token everyone would be
 * refused; this fills a missing `groups` or `email` from the userinfo
 * endpoint, for the same subject only.
 *
 * No `image`: Pocket ID's picture URL is on the LAN-only id.markrwatts.com,
 * so it would be a broken avatar away from home.
 */
export async function getPocketIdUserInfo(
  tokens: { idToken?: string; accessToken?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GenericOAuthUserInfo | null> {
  let claims: Claims = (tokens.idToken && decodeJwtPayload(tokens.idToken)) || {};

  if ((!Array.isArray(claims.groups) || !claims.email) && tokens.accessToken) {
    try {
      const res = await fetchImpl(POCKET_ID_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const info = (await res.json()) as Claims;
        if (typeof info?.sub === "string" && (claims.sub === undefined || info.sub === claims.sub)) {
          claims = { ...info, ...claims, groups: claims.groups ?? info.groups, email: claims.email ?? info.email };
        }
      }
    } catch {
      // Carry on with the ID token's claims; without groups, the sign-in is refused.
    }
  }

  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return {
    ...claims,
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : "",
  };
}
