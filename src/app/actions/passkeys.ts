"use server";

// Passkey management for the signed-in user on /account: rename and remove.
// ADDING one isn't here — the WebAuthn registration ceremony is a browser
// API, so it runs client-side via authClient.passkey.addPasskey (see
// components/account/PasskeyManager.tsx).
//
// Authorization is the plugin's: both endpoints below check the session and
// that the passkey belongs to it, so a forged `id` for someone else's
// passkey is refused regardless of what this action does. This layer adds
// the app's own input bounds.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { isTooLong } from "@/lib/validation";
import { PASSKEY_NAME_MAX_LENGTH } from "@/lib/passkey-label";

export type PasskeyActionState = { error?: string } | null;

export async function renamePasskey(
  _prevState: PasskeyActionState,
  formData: FormData,
): Promise<PasskeyActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/signin");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { error: "Which passkey?" };
  if (!name) return { error: "Give it a name." };
  if (isTooLong(name, PASSKEY_NAME_MAX_LENGTH)) return { error: "That name is a bit long." };

  try {
    await auth.api.updatePasskey({ body: { id, name }, headers: await headers() });
  } catch {
    // Not found, or not theirs — one message for both.
    return { error: "Couldn't rename that passkey." };
  }

  revalidatePath("/account");
  return null;
}

export async function removePasskey(
  _prevState: PasskeyActionState,
  formData: FormData,
): Promise<PasskeyActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/signin");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Which passkey?" };

  try {
    await auth.api.deletePasskey({ body: { id }, headers: await headers() });
  } catch {
    return { error: "Couldn't remove that passkey." };
  }

  revalidatePath("/account");
  return null;
}
