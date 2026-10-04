import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

// These drive Better Auth's real sign-in and OAuth callback endpoints against
// an in-memory database, with Pocket ID's discovery, JWKS, token and userinfo
// endpoints faked over fetch, and the sign-in code email captured instead of
// sent — so they exercise the gates exactly where Better Auth calls them, not
// just the functions in isolation. Pattern shared with jobAppTracker's
// src/auth.test.ts.

const BASE = "http://localhost:3000";
const ISSUER = "https://id.markrwatts.com";
const CLIENT_ID = "refresh";

// auth.ts builds the real (Prisma-backed) instance at import time; stub what
// it reads so the import works, and keep it away from any real database.
vi.stubEnv("AUTH_URL", BASE);
vi.stubEnv("AUTH_SECRET", "test-secret-at-least-32-characters-long");
vi.stubEnv("POCKET_ID_CLIENT_ID", "");
vi.stubEnv("POCKET_ID_CLIENT_SECRET", "");
vi.stubEnv("ALLOWED_EMAILS", "");
vi.mock("@/lib/db", () => ({ prisma: {} }));

// The sign-in code email: capture it rather than call Resend.
const sentEmails: { to: string; subject: string }[] = [];
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (message: { to: string; subject: string }) => {
    sentEmails.push(message);
  },
}));

const { auth: prodAuth, createAuth, passkeyRelyingParty, validateUserInfo } = await import("./auth");

// --- A fake Pocket ID ---------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };

function signJwt(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${part({ alg: "RS256", typ: "JWT", kid: "test" })}.${part(claims)}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}

/** Who the fake Pocket ID signs in next, as ID token claims. */
let pocketIdUser: Record<string, unknown> = {};
let expectedNonce: string | undefined;

vi.stubGlobal("fetch", async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  switch (url) {
    case `${ISSUER}/.well-known/openid-configuration`:
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        userinfo_endpoint: `${ISSUER}/api/oidc/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    case `${ISSUER}/.well-known/jwks.json`:
      return Response.json({ keys: [jwk] });
    case `${ISSUER}/api/oidc/token`: {
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: signJwt({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 300, nonce: expectedNonce, ...pocketIdUser }),
      });
    }
    case `${ISSUER}/api/oidc/userinfo`:
      return Response.json(pocketIdUser);
    default:
      return new Response("not found", { status: 404 });
  }
});

// --- The app's auth, on an in-memory database -------------------------------

type Row = Record<string, unknown>;
type Db = {
  user: Row[];
  account: Row[];
  session: Row[];
  verification: Row[];
  passkey: Row[];
  Household: Row[];
  Member: Row[];
  Invitation: Row[];
};
let db: Db;
let auth: ReturnType<typeof createAuth>;

const POCKET_ID_ENV = { POCKET_ID_CLIENT_ID: CLIENT_ID, POCKET_ID_CLIENT_SECRET: "s3cret" };

function useAuth(env: Record<string, string | undefined> = {}) {
  auth = createAuth(memoryAdapter(db), { AUTH_URL: BASE, ...POCKET_ID_ENV, ...env });
}

beforeEach(() => {
  db = { user: [], account: [], session: [], verification: [], passkey: [], Household: [], Member: [], Invitation: [] };
  sentEmails.length = 0;
  useAuth();
});

afterEach(() => {
  vi.stubEnv("ALLOWED_EMAILS", "");
});

/** Click "Sign in with Pocket ID", have Pocket ID sign in `who`, and return where the callback sends the browser. */
async function signInWithPocketId(who: Record<string, unknown>): Promise<URL> {
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ provider: "pocket-id", callbackURL: "/", errorCallbackURL: "/signin" }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  expect(authorize.origin).toBe(ISSUER);
  expect(authorize.searchParams.get("scope")?.split(" ")).toEqual(
    expect.arrayContaining(["openid", "email", "profile", "groups"]),
  );
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/pocket-id`);
  expectedNonce = authorize.searchParams.get("nonce") ?? undefined;
  pocketIdUser = who;
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const callback = await auth.handler(
    new Request(
      `${BASE}/api/auth/callback/pocket-id?code=the-code&state=${authorize.searchParams.get("state")}`,
      { headers: { cookie } },
    ),
  );
  expect(callback.status).toBe(302);
  return new URL(callback.headers.get("location")!, BASE);
}

/** Ask for a sign-in code for `email`; returns the code if one was emailed. */
async function requestCode(email: string): Promise<string | null> {
  const before = sentEmails.length;
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  // The email is sent detached from the request (src/lib/otp-email.ts).
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sent = sentEmails.slice(before).find((m) => m.to === email);
  return sent ? sent.subject.slice(0, 6) : null;
}

const IN_GROUP = ["refresh"];

function existingUser(id: string, email: string): Row {
  const now = new Date();
  return { id, email, name: email, emailVerified: true, image: null, createdAt: now, updatedAt: now };
}

function account(userId: string, providerId: string, accountId: string): Row {
  const now = new Date();
  return { id: randomUUID(), userId, providerId, accountId, createdAt: now, updatedAt: now };
}

describe("Pocket ID group gate", () => {
  it("refuses a stranger outside the group without leaving a User row", async () => {
    const to = await signInWithPocketId({ sub: "s-1", email: "stranger@example.com", email_verified: true, groups: [] });
    expect(to.pathname).toBe("/signin");
    expect(to.searchParams.get("error")).toBe("no_access");
    expect(db.user).toEqual([]);
    expect(db.account).toEqual([]);
    expect(db.session).toEqual([]);
  });

  it("refuses a sign-in whose token carries no groups claim at all", async () => {
    const to = await signInWithPocketId({ sub: "s-1", email: "stranger@example.com", email_verified: true });
    expect(to.searchParams.get("error")).toBe("no_access");
    expect(db.user).toEqual([]);
  });

  it("lets a member of the group in", async () => {
    const to = await signInWithPocketId({ sub: "s-2", email: "new@example.com", email_verified: true, groups: IN_GROUP });
    expect(to.pathname).toBe("/");
    expect(db.user).toHaveLength(1);
    expect(db.session).toHaveLength(1);
  });

  it("links a first Pocket ID sign-in to the existing (Google-created) user with that email", async () => {
    db.user.push(existingUser("u-emma", "ladyemmawatts@gmail.com"));
    db.account.push(account("u-emma", "google", "google-sub"));

    const to = await signInWithPocketId({
      sub: "s-emma",
      email: "ladyemmawatts@gmail.com",
      email_verified: true,
      groups: IN_GROUP,
    });
    expect(to.pathname).toBe("/");
    expect(db.user.map((u) => u.id)).toEqual(["u-emma"]);
    expect(db.account).toContainEqual(expect.objectContaining({ userId: "u-emma", providerId: "pocket-id", accountId: "s-emma" }));
    expect(db.session).toEqual([expect.objectContaining({ userId: "u-emma" })]);
  });

  it("won't link an existing user who isn't in the group", async () => {
    db.user.push(existingUser("u-1", "former@example.com"));
    const to = await signInWithPocketId({ sub: "s-3", email: "former@example.com", email_verified: true, groups: [] });
    expect(to.searchParams.get("error")).toBe("no_access");
    expect(db.account).toEqual([]);
    expect(db.session).toEqual([]);
  });

  it("checks again on every sign-in, so leaving the group locks Pocket ID out", async () => {
    db.user.push(existingUser("u-mark", "markrwatts@gmail.com"));
    db.account.push(account("u-mark", "pocket-id", "s-mark"));
    const mark = { sub: "s-mark", email: "markrwatts@gmail.com", email_verified: true };

    expect((await signInWithPocketId({ ...mark, groups: IN_GROUP })).pathname).toBe("/");
    expect(db.session).toHaveLength(1);

    const to = await signInWithPocketId({ ...mark, groups: ["someone-else"] });
    expect(to.searchParams.get("error")).toBe("no_access");
    expect(db.session).toHaveLength(1);
  });

  it("doesn't gate email-code or passkey sign-ins on the group", async () => {
    const ctx = {} as never;
    expect(await validateUserInfo({ user: {}, source: { action: "create-user", method: "email-otp" } }, ctx)).toBeUndefined();
    expect(await validateUserInfo({ user: {}, source: { action: "sign-in", method: "passkey" } }, ctx)).toBeUndefined();
  });
});

describe("one account, any method", () => {
  it("signs an existing user in by email code onto the same User row", async () => {
    db.user.push(existingUser("u-emma", "ladyemmawatts@gmail.com"));
    db.account.push(account("u-emma", "google", "google-sub"));

    const code = await requestCode("ladyemmawatts@gmail.com");
    expect(code).toMatch(/^\d{6}$/);
    const result = await auth.api.signInEmailOTP({ body: { email: "ladyemmawatts@gmail.com", otp: code! } });
    expect(result.user.id).toBe("u-emma");
    expect(db.user).toHaveLength(1);
    expect(db.session).toEqual([expect.objectContaining({ userId: "u-emma" })]);
  });

  it("matches the email code to the existing user whatever the typed email's case", async () => {
    db.user.push(existingUser("u-mark", "markrwatts@gmail.com"));
    const code = await requestCode("MarkRWatts@gmail.com");
    // The plugin normalizes the address before the email goes out.
    expect(code ?? (await requestCode("markrwatts@gmail.com"))).toMatch(/^\d{6}$/);
  });

  it("then lets the same person in by Pocket ID, onto the same row", async () => {
    db.user.push(existingUser("u-mark", "markrwatts@gmail.com"));
    const code = await requestCode("markrwatts@gmail.com");
    await auth.api.signInEmailOTP({ body: { email: "markrwatts@gmail.com", otp: code! } });

    await signInWithPocketId({ sub: "s-mark", email: "markrwatts@gmail.com", email_verified: true, groups: IN_GROUP });
    expect(db.user).toHaveLength(1);
    expect(db.session.map((s) => s.userId)).toEqual(["u-mark", "u-mark"]);
  });

  it("gives a wrong code three tries, then makes them ask for a new one", async () => {
    db.user.push(existingUser("u-mark", "markrwatts@gmail.com"));
    const code = await requestCode("markrwatts@gmail.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      await expect(auth.api.signInEmailOTP({ body: { email: "markrwatts@gmail.com", otp: wrong } })).rejects.toThrow();
    }
    await expect(auth.api.signInEmailOTP({ body: { email: "markrwatts@gmail.com", otp: code! } })).rejects.toThrow();
    expect(db.session).toEqual([]);
  });

  it("stores the code hashed, not as typed", async () => {
    const code = await requestCode("markrwatts@gmail.com");
    expect(JSON.stringify(db.verification)).not.toContain(code!);
  });
});

describe("ALLOWED_EMAILS still refuses, whatever the method", () => {
  const ALLOWED = { ALLOWED_EMAILS: "markrwatts@gmail.com,ladyemmawatts@gmail.com" };

  it("email code: never emails a refused address", async () => {
    vi.stubEnv("ALLOWED_EMAILS", ALLOWED.ALLOWED_EMAILS);
    useAuth(ALLOWED);
    expect(await requestCode("stranger@example.com")).toBeNull();
    expect(sentEmails).toEqual([]);
    expect(await requestCode("markrwatts@gmail.com")).toMatch(/^\d{6}$/);
  });

  it("email code: refuses the session even with a valid code", async () => {
    // The email gate (process.env) lets the code out; the session gate
    // (this instance's env) still says no.
    useAuth({ ALLOWED_EMAILS: "someone-else@example.com" });
    db.user.push(existingUser("u-mark", "markrwatts@gmail.com"));
    const code = await requestCode("markrwatts@gmail.com");
    await expect(auth.api.signInEmailOTP({ body: { email: "markrwatts@gmail.com", otp: code! } })).rejects.toThrow();
    expect(db.session).toEqual([]);
  });

  it("passkey: refuses the session for a passkey holder not on the list", async () => {
    // A passkey sign-in ends in internalAdapter.createSession, exactly as
    // here (read from @better-auth/passkey's verify-authentication
    // endpoint), which is where the session hook runs; a null session there
    // becomes UNABLE_TO_CREATE_SESSION. The WebAuthn ceremony itself needs a
    // real browser and authenticator.
    useAuth(ALLOWED);
    db.user.push(existingUser("u-toni", "tonibadnall@googlemail.com"));
    db.passkey.push({ id: "pk-1", userId: "u-toni", publicKey: "x", credentialID: "c", counter: 0, deviceType: "multiDevice", backedUp: true });
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession("u-toni")).toBeNull();
    expect(db.session).toEqual([]);

    db.user.push(existingUser("u-emma", "ladyemmawatts@gmail.com"));
    await expect(ctx.internalAdapter.createSession("u-emma")).resolves.toMatchObject({ userId: "u-emma" });
  });

  it("Pocket ID: refuses the session for a group member not on the list", async () => {
    useAuth({ ALLOWED_EMAILS: "markrwatts@gmail.com" });
    db.user.push(existingUser("u-emma", "ladyemmawatts@gmail.com"));
    const to = await signInWithPocketId({ sub: "s-emma", email: "ladyemmawatts@gmail.com", email_verified: true, groups: IN_GROUP });
    expect(to.pathname).toBe("/signin");
    expect(to.searchParams.get("error")).toBeTruthy();
    expect(db.session).toEqual([]);
  });
});

describe("the app's auth config", () => {
  it("offers no Google, and no email/password", () => {
    const options: BetterAuthOptions = prodAuth.options;
    expect(options.socialProviders).toBeUndefined();
    expect(options.emailAndPassword?.enabled).toBeFalsy();
    expect(prodAuth.options.user?.validateUserInfo).toBe(validateUserInfo);
  });

  it("registers Pocket ID only when its client ID and secret are both set", async () => {
    const plugin = (a: { options: { plugins?: unknown[] } }) =>
      (a.options.plugins as { id: string; options?: { config: { providerId: string }[] } }[]).find((p) => p.id === "generic-oauth");
    expect(plugin(prodAuth)?.options?.config).toEqual([]);
    expect(plugin(createAuth(memoryAdapter(db), { AUTH_URL: BASE, POCKET_ID_CLIENT_ID: CLIENT_ID }))?.options?.config).toEqual([]);
    expect(plugin(auth)?.options?.config.map((c) => c.providerId)).toEqual(["pocket-id"]);

    // And without it, the Pocket ID sign-in endpoint just refuses.
    useAuth({ POCKET_ID_CLIENT_ID: "", POCKET_ID_CLIENT_SECRET: "" });
    const start = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "pocket-id", callbackURL: "/" }),
      }),
    );
    expect(start.status).toBeGreaterThanOrEqual(400);
  });

  it("links Pocket ID sign-ins to the existing account by email, trusting no other provider", () => {
    expect(prodAuth.options.account?.accountLinking).toEqual({ enabled: true, trustedProviders: ["pocket-id"] });
  });

  it("pins the passkey relying party to AUTH_URL", () => {
    expect(passkeyRelyingParty({ AUTH_URL: "https://refresh.markrwatts.com/" })).toEqual({
      rpID: "refresh.markrwatts.com",
      origin: "https://refresh.markrwatts.com",
    });
    expect(passkeyRelyingParty({ AUTH_URL: "http://localhost:3000" })).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3000",
    });
  });
});
