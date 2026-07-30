import { LOGO_SVG_BODY, LOGO_VIEW_BOX } from "@/lib/brand/logo";

export default function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      // LOGO_SVG_BODY is a hardcoded design constant, not user input.
      dangerouslySetInnerHTML={{ __html: LOGO_SVG_BODY }}
    />
  );
}
