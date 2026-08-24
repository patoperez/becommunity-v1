import Link from "next/link";
import type { ReactNode } from "react";
import { BeCommunityLockup } from "@/components/BrandMark";
import { BackLink, type StudioParent } from "./BackLink";

/**
 * Be Community Studio — the internal shell.
 *
 * Studio wears Be Community's own colours, never the client's. A consultant
 * moving between clients all day must never be confused about whose data is on
 * screen; that is a safety property, not a stylistic preference.
 *
 * MIGRATION BOUNDARY (P8-A): every internal screen now wears this shell, but
 * they keep their existing `/admin/*` addresses, their forms, their Server
 * Actions and their query semantics. The stops below are therefore labelled in
 * product language while pointing at the real routes. Moving them onto the
 * `/studio/*` addresses the information architecture defines is P8-B.
 *
 * NAVIGATION. Each page declares an explicit PARENT (`back`), never
 * `history.back()`. Deep links, reloads and emailed URLs are the normal way
 * these pages are reached, and in all of those the history stack is empty or
 * wrong. Nothing here intercepts history, so browser Back still behaves
 * normally.
 */

export type StudioStop = {
  href: string;
  label: string;
  description: string;
  /** True for the destination the reader is currently in. */
  current?: boolean;
};

export const STUDIO_STOPS: StudioStop[] = [
  {
    href: "/dashboard",
    label: "Inicio",
    description: "Lo que hay en marcha y por dónde seguir.",
  },
  {
    href: "/admin/studies",
    label: "Estudios y plantillas",
    description: "Crear, configurar y publicar el trabajo de cada cliente.",
  },
  {
    href: "/admin/upload",
    label: "Carga de datos",
    description: "Traer un archivo nuevo y revisarlo antes de guardarlo.",
  },
  {
    href: "/admin/qualitative",
    label: "Lo que dijeron las personas",
    description: "Confirmar temas y aprobar citas antes de publicarlas.",
  },
  {
    href: "/admin/clients",
    label: "Clientes y accesos",
    description: "Quién es cliente, quién entra y qué puede ver cada persona.",
  },
];

export function StudioShell({
  userEmail,
  breadcrumb,
  back,
  title,
  lead,
  utility,
  currentHref,
  headerAccent,
  children,
}: {
  userEmail: string;
  /** "Dónde estoy": the trail, always naming the client when there is one. */
  breadcrumb?: string[];
  /**
   * The explicit parent. Omitted on the Studio home, which has none — a back
   * control that points at the page you are already on is worse than none.
   */
  back?: StudioParent;
  title: string;
  lead?: string;
  utility?: ReactNode;
  currentHref?: string;
  /** An optional tinted band behind the page heading, for section identity. */
  headerAccent?: { surface: string; line: string };
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-surface-page">
      <header className="border-b border-line bg-ink text-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BeCommunityLockup tone="paper" size="sm" />
            <span className="rounded-full border border-paper/30 px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-paper/80">
              Studio
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 max-w-[9rem] truncate text-sm text-paper/75 sm:max-w-xs">
              {userEmail}
            </span>
            {utility}
          </div>
        </div>

        <nav aria-label="Secciones de Studio" className="border-t border-paper/15">
          <ul className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-3 sm:px-4">
            {STUDIO_STOPS.map((stop) => {
              const current = stop.current ?? stop.href === currentHref;
              return (
                <li key={stop.href} className="shrink-0">
                  <Link
                    href={stop.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-medium transition-colors duration-[var(--motion-state)] ${
                      current
                        ? "border-yellow text-paper"
                        : "border-transparent text-paper/70 hover:border-paper/40 hover:text-paper"
                    }`}
                  >
                    {stop.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-6 sm:py-8">
        {/* The back control sits above the heading, in the normal flow, so it is
            visible at every width without ever covering content. */}
        {back ? (
          <nav aria-label="Volver" className="mb-3">
            <BackLink parent={back} />
          </nav>
        ) : null}

        {breadcrumb && breadcrumb.length > 0 ? (
          <nav aria-label="Ruta" className="mb-3">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {breadcrumb.map((crumb, index) => (
                <li key={crumb} className="flex items-center gap-2">
                  {index > 0 ? <span aria-hidden="true">›</span> : null}
                  <span className={index === breadcrumb.length - 1 ? "text-strong" : undefined}>
                    {crumb}
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div
          className={headerAccent ? "rounded-xl border px-5 py-4 sm:px-6 sm:py-5" : undefined}
          style={
            headerAccent
              ? { backgroundColor: headerAccent.surface, borderColor: headerAccent.line }
              : undefined
          }
        >
          <h1 className="text-3xl">{title}</h1>
          {lead ? <p className="mt-2 max-w-2xl text-base text-muted">{lead}</p> : null}
        </div>

        <div className="mt-7">{children}</div>
      </main>
    </div>
  );
}
