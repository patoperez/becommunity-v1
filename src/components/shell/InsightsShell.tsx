import type { ReactNode } from "react";
import { studyAccentVars } from "@/lib/brand/contrast";
import type { BrandConfig } from "@/lib/branding/config";
import { BrandMark } from "@/components/BrandMark";

/**
 * Be Community Insights — the client shell.
 *
 * Minimal, study-aware, branding-aware. The client mostly sees their own
 * identity; the product name stays quiet, which is the naming rule the
 * information architecture fixes.
 *
 * The tenant's colour reaches the screen ONLY through `studyAccentVars`, which
 * resolves it against a contrast floor. No component below reads a raw brand
 * hex, so a light client colour can no longer produce white-on-white (F4).
 */
export function InsightsShell({
  brandName,
  tagline,
  brand,
  logoUrl,
  userEmail,
  banner,
  utility,
  children,
}: {
  brandName: string;
  tagline: string | null;
  brand: BrandConfig;
  logoUrl: string | null;
  /** Rendered inside the page header — the app's own identity signal. */
  userEmail: string;
  /** An optional strip above the header (used by the internal client preview). */
  banner?: ReactNode;
  /** Sign-out and anything else that belongs to the account, not the study. */
  utility?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-1 flex-col bg-surface-page"
      style={studyAccentVars(brand.primaryColor)}
    >
      {banner}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <>
                {/* Tenant Storage URLs are dynamic, so the static Next Image
                    remote allowlist cannot cover them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt={`Logotipo de ${brandName}`}
                  className="h-11 w-11 shrink-0 rounded-lg border border-line bg-white object-contain p-1"
                />
              </>
            ) : (
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--study-accent)" }}
              >
                <BrandMark color="var(--study-accent-on)" size={22} />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-semibold text-strong">
                {brandName}
              </p>
              {tagline ? (
                <p className="truncate text-xs text-muted">{tagline}</p>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {/* Kept visible at every width — truncated, never hidden. It is the
                application's own answer to "who am I signed in as", and the
                isolation suite reads exactly this to confirm the app reports
                the actor as itself. */}
            <span className="min-w-0 max-w-[9rem] truncate text-sm text-muted sm:max-w-xs">
              {userEmail}
            </span>
            {utility}
          </div>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-6 sm:py-11">
        {children}
      </main>

      <footer className="border-t border-line px-5 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <BrandMark size={14} color="currentColor" />
            Análisis y lectura por Be Community
          </span>
        </div>
      </footer>
    </div>
  );
}
