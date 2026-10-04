import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requestOTP, signInWithPocketId } from "@/app/actions/auth-flow";
import SubmitButton from "@/components/SubmitButton";
import { OTPForm } from "@/components/auth/OTPForm";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";
import { isHomeNetworkRequest } from "@/lib/auth/home-network";
import { NO_ACCESS_ERROR, REQUIRED_GROUP, pocketIdConfig } from "@/lib/auth/pocket-id";
import { OTP_EMAIL_COOKIE } from "@/lib/flow-cookies";
import { verifyOtpFlow } from "@/lib/otp-flow-token";
import { safeCallbackURL } from "@/lib/safe-callback";

const PRIMARY_BUTTON_CLASSNAME =
  "flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";
const POCKET_ID_BUTTON_CLASSNAME =
  "flex w-full items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:opacity-60";
const INPUT_CLASSNAME =
  "w-full rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none";

// Codes /signin can be sent back with: its own actions' (app/actions/
// auth-flow.ts), and Better Auth's from a refused Pocket ID callback.
function errorMessage(error: string): string {
  switch (error) {
    case "MissingEmail":
      return "Enter an email address first.";
    case "BadEmail":
      return "That email address doesn't look right.";
    case "TooMany":
      return "Too many sign-in codes requested — wait a little and try again.";
    case "SendFailed":
      return "Couldn't send your code — try again in a moment.";
    case "PocketIdUnavailable":
      return "Couldn't reach Pocket ID — use an email code instead.";
    case NO_ACCESS_ERROR:
      return `Your Pocket ID account isn't in the ${REQUIRED_GROUP} group, so it can't sign in to re:Fresh. Use an email code instead, or ask a Pocket ID admin.`;
    case "account_not_linked":
    case "unable_to_link_account":
    case "email_doesn't_match":
      return "That Pocket ID account couldn't be linked to your re:Fresh account — use an email code instead.";
    default:
      return `Sign-in hit a snag (${error}) — try again in a moment.`;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; otp?: string; deleted?: string; callbackURL?: string }>;
}) {
  const { error, otp, deleted, callbackURL: callbackURLRaw } = await searchParams;
  const callbackURL = safeCallbackURL(callbackURLRaw);
  const requestHeaders = await headers();

  // Real (database-validated) session check — a genuinely signed-in user
  // skips the sign-in page. Deliberately NOT done in proxy.ts: its
  // cookie-presence check can't tell a stale/foreign cookie from a live
  // session and would redirect-loop.
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (session?.user) redirect(callbackURL);

  // Step 2 needs the flow cookie; without it (expired, cleared) fall back to
  // step 1 regardless of the query param.
  const otpEmail = otp ? verifyOtpFlow((await cookies()).get(OTP_EMAIL_COOKIE)?.value)?.email : undefined;

  // Pocket ID only answers on the home network, so the button only shows
  // there — see src/lib/auth/home-network.ts for how that's told apart.
  const offerPocketId = pocketIdConfig() !== null && isHomeNetworkRequest(requestHeaders);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <Image
          src="/brand/wordmark.png"
          alt="re:Fresh"
          width={1895}
          height={271}
          className="h-8 w-auto"
          priority
        />

        {deleted ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Your account has been deleted.
          </p>
        ) : error ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {errorMessage(error)}
          </p>
        ) : null}

        {otpEmail ? (
          <>
            <p className="text-sm text-zinc-600">
              If <span className="font-semibold text-zinc-900">{otpEmail}</span> can sign in to
              re:Fresh, we&apos;ve emailed it a six-digit code. It expires in 10 minutes.
            </p>
            <OTPForm callbackURL={callbackURL} />
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <form action={requestOTP}>
                <input type="hidden" name="email" value={otpEmail} />
                <input type="hidden" name="callbackURL" value={callbackURL} />
                <button type="submit" className="underline-offset-2 hover:text-zinc-600 hover:underline">
                  Send a fresh code
                </button>
              </form>
              <Link
                href={`/signin?callbackURL=${encodeURIComponent(callbackURL)}`}
                className="underline-offset-2 hover:text-zinc-600 hover:underline"
              >
                Use a different email
              </Link>
            </div>
          </>
        ) : (
          <>
            <form action={requestOTP} className="flex w-full flex-col gap-3">
              <input type="hidden" name="callbackURL" value={callbackURL} />
              {/* "webauthn" is the conditional-UI hook: a browser that
                  supports passkey autofill offers this person's passkey
                  inside this field's autofill sheet (PasskeySignInButton
                  starts that ceremony). */}
              <input
                type="email"
                name="email"
                required
                autoComplete="username webauthn"
                placeholder="you@example.com"
                className={INPUT_CLASSNAME}
              />
              <input
                type="text"
                name="name"
                maxLength={256}
                autoComplete="name"
                placeholder="Your name (new accounts only)"
                className={INPUT_CLASSNAME}
              />
              <SubmitButton
                label="Email me a sign-in code"
                pendingLabel="Sending…"
                className={PRIMARY_BUTTON_CLASSNAME}
              />
            </form>

            <div className="flex w-full items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200" />
              or
              <span className="h-px flex-1 bg-zinc-200" />
            </div>

            <div className="flex w-full flex-col gap-3">
              {/* Existing accounts only; renders nothing on browsers that
                  can't do passkeys. */}
              <PasskeySignInButton callbackURL={callbackURL} />

              {offerPocketId && (
                <form action={signInWithPocketId} className="w-full">
                  <input type="hidden" name="callbackURL" value={callbackURL} />
                  <SubmitButton
                    label="Sign in with Pocket ID"
                    pendingLabel="Off to Pocket ID…"
                    className={POCKET_ID_BUTTON_CLASSNAME}
                  />
                </form>
              )}
            </div>
          </>
        )}

        <Link href="/" className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline">
          Back to re:Fresh
        </Link>
      </div>
    </main>
  );
}
