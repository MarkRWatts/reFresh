import Image from "next/image";

/** The icon mark already bakes in the "re:Fresh" wordmark, so no adjacent text is needed alongside it. */
export default function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <Image
      src="/brand/refresh-icon.png"
      alt="re:Fresh"
      width={144}
      height={144}
      className={`${className} rounded-lg object-cover`}
      priority
    />
  );
}
