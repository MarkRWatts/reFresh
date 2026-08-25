"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that shows its own pending state — needed wherever a
 * server-action form can take more than an instant (OCR parsing, image
 * promotion, etc.), since without it a click just looks like nothing
 * happened. Has to be its own component: useFormStatus only reports the
 * form it's actually inside, not the page around it.
 */
export default function SubmitButton({
  label,
  pendingLabel,
  className,
  icon,
}: {
  label: string;
  pendingLabel: string;
  className: string;
  /** Optional leading icon (e.g. a brand mark) shown before the label — hidden while pending, replaced by the spinner. */
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (
        <span
          aria-hidden
          className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/40 border-t-current align-[-2px]"
        />
      ) : (
        icon
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}
