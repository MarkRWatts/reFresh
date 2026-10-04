import { beforeEach, describe, expect, it, vi } from "vitest";

// The email-code actions with Next's request APIs and Better Auth stubbed:
// what's under test is the app's own layer on top — the in-process
// throttles (src/lib/throttle.ts) and the signed flow cookie
// (src/lib/otp-flow-token.ts). Better Auth's own handling of the code is
// covered end to end in src/auth.test.ts.

vi.stubEnv("AUTH_SECRET", "test-secret-at-least-32-characters-long");

let requestHeaders = new Headers();
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const sendVerificationOTP = vi.fn<(args: unknown) => Promise<{ success: boolean }>>(async () => ({ success: true }));
const signInEmailOTP = vi.fn<(args: { body: { email: string; otp: string } }) => Promise<void>>(async () => {
  throw new Error("invalid OTP");
});
vi.mock("@/auth", () => ({ auth: { api: { sendVerificationOTP, signInEmailOTP } } }));

const { requestOTP, verifyOTP } = await import("./auth-flow");
const { OTP_EMAIL_COOKIE } = await import("@/lib/flow-cookies");
const { signOtpFlow } = await import("@/lib/otp-flow-token");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

/** Run an action that ends in redirect(); return where it sent the browser. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

function fromIp(ip: string) {
  requestHeaders = new Headers({ "cf-connecting-ip": ip });
}

beforeEach(() => {
  // Every test starts with empty throttles (the registry is process-wide).
  (globalThis as unknown as { __refreshThrottles?: Map<string, unknown> }).__refreshThrottles?.clear();
  jar.clear();
  sendVerificationOTP.mockClear();
  signInEmailOTP.mockClear();
  vi.useRealTimers();
  fromIp("203.0.113.1");
});

describe("requestOTP throttle", () => {
  it("sends a code, then refuses a resend inside the 30-second cooldown but keeps the code step", async () => {
    const first = await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })));
    expect(first).toBe("/signin?otp=1&callbackURL=%2F");
    expect(sendVerificationOTP).toHaveBeenCalledTimes(1);

    const resend = await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })));
    expect(resend).toBe("/signin?error=TooMany&otp=1&callbackURL=%2F");
    expect(sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  it("allows 6 codes an hour per address and IP", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 6; i++) {
      expect(await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })))).toContain("otp=1");
      vi.advanceTimersByTime(31_000);
    }
    expect(await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })))).toContain("error=TooMany");
    expect(sendVerificationOTP).toHaveBeenCalledTimes(6);
  });

  it("caps one IP at 10 sends in 10 minutes, whatever addresses it makes up", async () => {
    for (let i = 0; i < 10; i++) {
      await redirectOf(requestOTP(form({ email: `made-up-${i}@example.com` })));
    }
    // The refused address never had a code sent, so it lands on the email form.
    expect(await redirectOf(requestOTP(form({ email: "made-up-10@example.com" })))).toBe(
      "/signin?error=TooMany&callbackURL=%2F",
    );
    expect(sendVerificationOTP).toHaveBeenCalledTimes(10);
  });

  it("doesn't let a stranger on another IP spend the owner's budget", async () => {
    fromIp("198.51.100.66");
    await redirectOf(requestOTP(form({ email: "ladyemmawatts@gmail.com" })));
    expect(await redirectOf(requestOTP(form({ email: "ladyemmawatts@gmail.com" })))).toContain("TooMany");

    fromIp("203.0.113.1");
    expect(await redirectOf(requestOTP(form({ email: "ladyemmawatts@gmail.com" })))).toBe("/signin?otp=1&callbackURL=%2F");
  });

  it("keys on x-forwarded-for on the LAN path, and on one shared bucket when there's no usable IP", async () => {
    requestHeaders = new Headers({ "x-forwarded-for": "192.168.1.20" });
    await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })));
    expect(await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })))).toContain("TooMany");

    requestHeaders = new Headers({ "x-forwarded-for": "1.2.3.4, 192.168.1.20" });
    await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })));
    requestHeaders = new Headers();
    expect(await redirectOf(requestOTP(form({ email: "markrwatts@gmail.com" })))).toContain("TooMany");
  });

  it("stores the email in a signed flow cookie, not as typed", async () => {
    await redirectOf(requestOTP(form({ email: "MarkRWatts@gmail.com" })));
    const cookie = jar.get(OTP_EMAIL_COOKIE)!;
    expect(cookie).not.toContain("@");
    expect(cookie.split(".")).toHaveLength(3);
  });
});

describe("verifyOTP throttle", () => {
  it("allows 6 checks per code request, then refuses without asking Better Auth", async () => {
    jar.set(OTP_EMAIL_COOKIE, signOtpFlow("markrwatts@gmail.com"));
    for (let i = 0; i < 6; i++) {
      expect(await verifyOTP(null, form({ otp: "000000" }))).toEqual({
        error: "That code didn't work — check it, or send a fresh one.",
      });
    }
    expect(await verifyOTP(null, form({ otp: "000000" }))).toEqual({
      error: "Too many attempts — wait a few minutes, then send a fresh code.",
    });
    expect(signInEmailOTP).toHaveBeenCalledTimes(6);
  });

  it("gives a fresh code request its own budget", async () => {
    jar.set(OTP_EMAIL_COOKIE, signOtpFlow("markrwatts@gmail.com"));
    for (let i = 0; i < 6; i++) await verifyOTP(null, form({ otp: "000000" }));
    jar.set(OTP_EMAIL_COOKIE, signOtpFlow("markrwatts@gmail.com"));
    await verifyOTP(null, form({ otp: "000000" }));
    expect(signInEmailOTP).toHaveBeenCalledTimes(7);
  });

  it("caps one IP at 30 checks in 10 minutes across code requests", async () => {
    for (let flow = 0; flow < 5; flow++) {
      jar.set(OTP_EMAIL_COOKIE, signOtpFlow(`person-${flow}@example.com`));
      for (let i = 0; i < 6; i++) await verifyOTP(null, form({ otp: "000000" }));
    }
    jar.set(OTP_EMAIL_COOKIE, signOtpFlow("another@example.com"));
    expect(await verifyOTP(null, form({ otp: "000000" }))).toEqual({
      error: "Too many attempts — wait a few minutes, then send a fresh code.",
    });
    expect(signInEmailOTP).toHaveBeenCalledTimes(30);
  });

  it("won't check codes against an address the browser never asked a code for", async () => {
    // A bare (unsigned) email in the cookie, as a stranger could set by hand.
    jar.set(OTP_EMAIL_COOKIE, "ladyemmawatts@gmail.com");
    expect(await redirectOf(verifyOTP(null, form({ otp: "000000" })))).toBe("/signin?callbackURL=%2F");
    expect(signInEmailOTP).not.toHaveBeenCalled();
  });

  it("signs in with the cookie's email on a good code", async () => {
    signInEmailOTP.mockResolvedValueOnce(undefined);
    jar.set(OTP_EMAIL_COOKIE, signOtpFlow("markrwatts@gmail.com"));
    expect(await redirectOf(verifyOTP(null, form({ otp: "123456", callbackURL: "/plan/print" })))).toBe("/plan/print");
    expect(signInEmailOTP.mock.calls[0][0].body).toMatchObject({ email: "markrwatts@gmail.com", otp: "123456" });
    expect(jar.has(OTP_EMAIL_COOKIE)).toBe(false);
  });
});
