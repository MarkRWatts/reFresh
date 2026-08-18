export default function EyeOffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
      <path d="M9.88 5.09A9.4 9.4 0 0 1 12 4.8c5 0 8.5 4.2 9.7 6.2a1.8 1.8 0 0 1 0 1.7 15.8 15.8 0 0 1-2.5 3.1M6.6 6.6C3.9 8.3 2.3 10.7 1.3 12.2a1.8 1.8 0 0 0 0 1.6c1.2 2 4.7 6.2 9.7 6.2a9.3 9.3 0 0 0 4.4-1.1" />
    </svg>
  );
}
