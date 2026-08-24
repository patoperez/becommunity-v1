/**
 * The Be Community hand mark.
 *
 * Taken from the live Be Community identity, where the raised hand is the
 * recurring device across the site. It is decorative by default (`aria-hidden`)
 * because it always sits beside the product name in text.
 */
export function BrandMark({
  color = "currentColor",
  size = 24,
  className,
  rotate = 0,
}: {
  color?: string;
  size?: number;
  className?: string;
  rotate?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill={color}
        d="M12 2c.6 0 1 .4 1 1v6h1V4c0-.6.4-1 1-1s1 .4 1 1v7h1V6c0-.6.4-1 1-1s1 .4 1 1v9c0 3.3-2.5 6-6 6-1.9 0-3.2-.7-4.2-1.7l-4-4c-.5-.5-.4-1.3.2-1.7.5-.3 1.2-.2 1.6.2L11 15V3c0-.6.4-1 1-1z"
      />
    </svg>
  );
}

/** The palette the identity uses for a row of hands. */
export const HAND_COLORS = [
  "#7FB2DD",
  "#E23B8A",
  "#F4B72A",
  "#7DB52E",
  "#9B84C4",
  "#1B72B8",
] as const;

/**
 * The Be Community wordmark lockup, used wherever the product speaks as itself
 * rather than as the client's brand.
 */
export function BeCommunityLockup({
  tone = "ink",
  size = "md",
}: {
  tone?: "ink" | "paper";
  size?: "sm" | "md" | "lg";
}) {
  const text = tone === "paper" ? "text-paper" : "text-ink";
  const scale = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  const glyph = size === "lg" ? 28 : size === "sm" ? 18 : 22;
  return (
    <span className={`flex items-center gap-2 ${text}`}>
      <BrandMark color="currentColor" size={glyph} />
      <span className={`font-display font-semibold tracking-tight ${scale}`}>
        Be Community
      </span>
    </span>
  );
}
