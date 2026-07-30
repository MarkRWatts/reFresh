export default function HeartIcon({
  filled,
  className = "h-4 w-4",
}: {
  filled: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 21s-6.716-4.35-9.428-8.485C.686 9.62 1.4 6.03 4.343 4.828 6.6 3.9 9.02 4.66 12 7.5c2.98-2.84 5.4-3.6 7.657-2.672 2.943 1.2 3.657 4.792 1.771 7.687C18.716 16.65 12 21 12 21z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
