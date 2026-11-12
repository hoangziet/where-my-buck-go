export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-accent shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden="true"
        width={size * 0.53}
        height={size * 0.53}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v18" />
        <path d="M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.3 5 3.3-2.2 3.2-5 3.2-5-1.2-5-3" />
      </svg>
    </span>
  );
}
