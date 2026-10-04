import { useSyncExternalStore } from "react";

// Client-only facts the passkey UI needs (/signin and /account),
// read without an effect: useSyncExternalStore with a server snapshot is
// React's own answer to "this value only exists in the browser" — the
// server and the hydration pass see the fallback, the first client render
// sees the real value, and no setState-in-an-effect cascade is involved.
// The values never change for the life of a page, so subscribe is a no-op.

export type PasskeySupport = "unknown" | "yes" | "insecure" | "no";

const subscribeNever = () => () => {};

function readSupport(): PasskeySupport {
  // WebAuthn is only available in a secure context (https or localhost):
  // plain-http LAN access to a dev server, say, gets "insecure" rather
  // than a button that silently fails.
  if (!window.isSecureContext) return "insecure";
  return window.PublicKeyCredential ? "yes" : "no";
}

/** "unknown" during SSR and hydration, then the browser's real answer. */
export function usePasskeySupport(): PasskeySupport {
  return useSyncExternalStore(subscribeNever, readSupport, () => "unknown");
}

/** The browser's user-agent string; "" during SSR and hydration. */
export function useUserAgent(): string {
  return useSyncExternalStore(subscribeNever, () => navigator.userAgent, () => "");
}
