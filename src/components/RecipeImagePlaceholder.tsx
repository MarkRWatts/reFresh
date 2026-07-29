/**
 * Shown in place of a recipe photo when HelloFresh's own source data has no
 * usable image (a real, fairly common gap — see project docs). A plain grey
 * box read as broken; this reads as an intentional empty state instead.
 */
export default function RecipeImagePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-50 to-zinc-100 ${className}`}
    >
      <svg
        viewBox="0 0 60 100"
        className="h-2/5 max-h-24 text-emerald-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* fork */}
        <path d="M14 8v22" />
        <path d="M20 8v22" />
        <path d="M26 8v22" />
        <path d="M20 30v62" />

        {/* knife */}
        <path d="M45 8 52 22 47 30 47 92 43 92 43 30 38 22Z" />
      </svg>
    </div>
  );
}
