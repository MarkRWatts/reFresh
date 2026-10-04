// Better Auth's React client, for the one thing server actions can't do:
// the WebAuthn ceremony is a browser API, so signing in with a passkey and
// adding one have to run in client components. Everything else still goes
// through server actions.
//
// No explicit baseURL: the client falls back to this app's own "/api/auth"
// on whatever origin served the page, which is right for localhost and
// production alike.
import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({ plugins: [passkeyClient()] });
