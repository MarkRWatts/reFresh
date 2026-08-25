import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SubmitButton from "@/components/SubmitButton";

const GOOGLE_BUTTON_CLASSNAME =
  "flex w-full items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:opacity-60";
const MAGIC_LINK_BUTTON_CLASSNAME =
  "flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";

// Only ever a same-origin app path (e.g. an invite link) — never an
// absolute URL, so this can't be turned into an open redirect by a crafted
// ?callbackURL= value.
function safeCallbackURL(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; callbackURL?: string }>;
}) {
  const { error, sent, callbackURL: callbackURLRaw } = await searchParams;
  const callbackURL = safeCallbackURL(callbackURLRaw);

  // Real (database-validated) session check — a genuinely signed-in user
  // skips the sign-in page. Deliberately NOT done in proxy.ts: its
  // cookie-presence check can't tell a stale/foreign cookie from a live
  // session and would redirect-loop.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect(callbackURL);

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

        {sent ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Check your email for a sign-in link — it expires in 10 minutes.
          </p>
        ) : error === "MissingEmail" ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Enter an email address first.
          </p>
        ) : error === "MagicLinkFailed" ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Couldn&apos;t send that sign-in link — try again in a moment.
          </p>
        ) : error ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sign-in hit a snag ({error}) — try again in a moment.
          </p>
        ) : null}

        <form
          action={async () => {
            "use server";
            // Unlike next-auth's signIn(), which redirects for you,
            // auth.api.signInSocial() just returns the provider's OAuth URL
            // — the caller has to redirect() to it explicitly.
            const { url } = await auth.api.signInSocial({
              body: { provider: "google", callbackURL },
            });
            if (url) redirect(url);
          }}
          className="w-full"
        >
          <SubmitButton
            label="Sign in with Google"
            pendingLabel="Off to Google…"
            className={GOOGLE_BUTTON_CLASSNAME}
            icon={<GoogleLogo />}
          />
        </form>

        <div className="flex w-full items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          or
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <form
          action={async (formData: FormData) => {
            "use server";
            const email = String(formData.get("email") ?? "").trim();
            const name = String(formData.get("name") ?? "").trim().slice(0, 256);
            const callbackParam = `&callbackURL=${encodeURIComponent(callbackURL)}`;
            if (!email) redirect(`/signin?error=MissingEmail${callbackParam}`);
            try {
              await auth.api.signInMagicLink({
                // name is only used by Better Auth if this email has no
                // account yet — an existing user's name is never touched.
                body: { email, name: name || undefined, callbackURL },
                headers: await headers(),
              });
            } catch {
              redirect(`/signin?error=MagicLinkFailed${callbackParam}`);
            }
            redirect(`/signin?sent=1${callbackParam}`);
          }}
          className="flex w-full flex-col gap-3"
        >
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
          />
          <input
            type="text"
            name="name"
            maxLength={256}
            placeholder="Your name (new accounts only)"
            className="w-full rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
          />
          <SubmitButton
            label="Email me a sign-in link"
            pendingLabel="Sending…"
            className={MAGIC_LINK_BUTTON_CLASSNAME}
          />
        </form>

        <Link href="/" className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline">
          Back to re:Fresh
        </Link>
      </div>
    </main>
  );
}

// Google's official "G" brand mark — see https://developers.google.com/identity/branding-guidelines
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}
