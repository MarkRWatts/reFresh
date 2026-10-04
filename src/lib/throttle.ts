// Small in-process sliding-window rate limiter for the sign-in server
// actions (src/app/actions/auth-flow.ts). Ported from MediaVault.
//
// Why this exists: BetterAuth's own rate limiter only runs inside its HTTP
// handler (/api/auth/*). This app drives the email-code flow through
// `auth.api.*` calls from server actions, which skip that handler — so the
// emailOTP plugin's 3-per-minute rules never applied to the forms people
// actually use. This is the app-side backstop: per-email and per-IP caps on
// sending a code and on checking one.
//
// Process-local Map, no persistence: the app runs as a single container, and
// a restart forgetting the counters is harmless (the plugin's own
// per-code attempt cap still holds). Entries expire on read and are swept
// when the map grows, so it can't grow without bound.

export interface ThrottleRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum hits allowed within any one window. */
  max: number;
}

export class SlidingWindowThrottle {
  private readonly hits = new Map<string, number[]>();
  private readonly sweepEvery: number;
  private readonly maxKeys: number;
  private sinceSweep = 0;

  constructor(private readonly rule: ThrottleRule, opts?: { sweepEvery?: number; maxKeys?: number }) {
    this.sweepEvery = opts?.sweepEvery ?? 1000;
    this.maxKeys = opts?.maxKeys ?? 10_000;
  }

  /** Record one hit for `key` and report whether it was within the limit.
   *  A refused hit is NOT recorded, so a flood doesn't extend its own
   *  lockout past the window. `now` is injectable for tests. */
  consume(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const cutoff = now - this.rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.rule.max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: recent[0] + this.rule.windowMs - now };
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keys can be attacker-chosen (email addresses), so the sweep, which
    // only drops expired entries, isn't a bound on its own. Past the cap,
    // evict oldest-inserted keys: a flood forgets its own early keys rather
    // than growing the heap without limit.
    if (this.hits.size > this.maxKeys) {
      this.sweep(now);
      for (const k of this.hits.keys()) {
        if (this.hits.size <= this.maxKeys) break;
        if (k !== key) this.hits.delete(k);
      }
    }
    if (++this.sinceSweep >= this.sweepEvery) this.sweep(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop every key with no hits inside the current window. */
  sweep(now: number = Date.now()): void {
    this.sinceSweep = 0;
    const cutoff = now - this.rule.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }

  /** Number of keys currently tracked — for tests. */
  get size(): number {
    return this.hits.size;
  }
}

// One shared instance per rule: module state survives across requests in
// the same process, which is exactly the point.
const globalForThrottle = globalThis as unknown as { __refreshThrottles?: Map<string, SlidingWindowThrottle> };
const registry = (globalForThrottle.__refreshThrottles ??= new Map());

export function throttle(name: string, rule: ThrottleRule): SlidingWindowThrottle {
  let t = registry.get(name);
  if (!t) {
    t = new SlidingWindowThrottle(rule);
    registry.set(name, t);
  }
  return t;
}

// The sign-in flow's actual limits. Sends are the expensive/abusable side
// (each one is an email to the address); checks are the brute-force side
// (the plugin already voids a code after 3 wrong guesses, so these caps
// mostly bound how fast someone can cycle fresh codes).
//
// Nothing here is keyed on a bare email: that string is supplied by anyone,
// so a per-email bucket let a stranger spend a victim's budget and lock them
// out of signing in. Send limits key on email+IP (the abuser exhausts their
// own bucket, the owner on another IP is untouched) and on IP alone; verify
// limits key on the signed flow id (src/lib/otp-flow-token.ts) and IP.
export const OTP_SEND_PER_EMAIL_IP = { windowMs: 60 * 60_000, max: 6 } satisfies ThrottleRule; // 6 codes / hour / address / IP
export const OTP_SEND_COOLDOWN_PER_EMAIL_IP = { windowMs: 30_000, max: 1 } satisfies ThrottleRule; // no faster than one per 30 s
export const OTP_SEND_PER_IP = { windowMs: 10 * 60_000, max: 10 } satisfies ThrottleRule; // 10 sends / 10 min / IP
export const OTP_CHECK_PER_FLOW = { windowMs: 10 * 60_000, max: 6 } satisfies ThrottleRule; // 6 checks per code request
export const OTP_CHECK_PER_IP = { windowMs: 10 * 60_000, max: 30 } satisfies ThrottleRule; // 30 checks / 10 min / IP
