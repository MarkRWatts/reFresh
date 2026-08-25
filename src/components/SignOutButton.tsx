// A tiny server component wrapping a sign-out server action in a POST form
// (no client JS needed). Better Auth has no direct signOut()-with-redirect
// helper — auth.api.signOut() only clears the session/cookie; the redirect
// is a separate, explicit step.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LogOut } from "lucide-react";
import { auth } from "@/auth";

export default function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form
      action={async () => {
        "use server";
        await auth.api.signOut({ headers: await headers() });
        // Without this, the header's Account/Sign-out state survives the
        // redirect stale (root layout's own render isn't re-run on this
        // soft navigation) — see createHousehold's comment for the same
        // root cause.
        revalidatePath("/", "layout");
        redirect("/signin");
      }}
    >
      {compact ? (
        <button
          type="submit"
          aria-label="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="submit"
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
        >
          Sign out
        </button>
      )}
    </form>
  );
}
