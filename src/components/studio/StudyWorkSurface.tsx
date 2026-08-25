import type { ReactNode } from "react";
import Link from "next/link";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIES_LIST, studyParent, type StudioParent } from "@/components/shell/BackLink";
import { logout } from "@/app/dashboard/actions";
import { Flash } from "@/components/studio/Flash";
import { StudyTabs, type StudyTabId } from "@/components/studio/StudyTabs";
import { studyStateLabel } from "@/lib/language/results";
import { studioClient } from "@/lib/studio/routes";
import type { StudioStudyWorkspace } from "@/lib/studio/study-workspace";

/**
 * The frame every surface inside one study shares (P8.2).
 *
 * The study is the object of work, so it has one address, one header naming the
 * client, one state chip, one row of process steps and one explicit way up.
 * Everything a consultant does to a study happens inside this frame instead of
 * being scattered across four pages that each had to be told which study they
 * were about.
 */
export function StudyWorkSurface({
  workspace,
  current,
  userEmail,
  title,
  lead,
  ok,
  error,
  children,
}: {
  workspace: StudioStudyWorkspace;
  current: StudyTabId;
  userEmail: string;
  title: string;
  lead?: string;
  ok?: string;
  error?: string;
  children: ReactNode;
}) {
  const { study } = workspace;
  // The resumen's parent is the study list; every step inside the study has the
  // study itself as its parent, so "up" is always one meaningful level.
  const back: StudioParent =
    current === "resumen" ? STUDIES_LIST : studyParent(study.id, study.name);

  return (
    <StudioShell
      userEmail={userEmail}
      currentHref="/studio/estudios"
      back={back}
      breadcrumb={["Studio", "Estudios", study.clientName, study.name]}
      title={title}
      lead={lead}
      utility={
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
          >
            Cerrar sesión
          </button>
        </form>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              study.status === "published"
                ? "border-positive-line bg-positive-surface text-positive"
                : study.status === "archived"
                  ? "border-line bg-surface-sunken text-muted"
                  : "border-caution-line bg-caution-surface text-caution"
            }`}
          >
            {studyStateLabel(study.status)}
          </span>
          <p className="min-w-0 text-sm text-muted">
            <Link
              href={studioClient(study.tenantId)}
              className="font-semibold text-evidence underline-offset-4 hover:underline"
            >
              {study.clientName}
            </Link>
            {study.period ? ` · ${study.period}` : " · sin periodo"}
          </p>
          {study.clientArchived ? (
            <span className="rounded-full border border-caution-line bg-caution-surface px-2.5 py-0.5 text-xs font-medium text-caution">
              Cliente archivado
            </span>
          ) : null}
        </div>

        <StudyTabs workspace={workspace} current={current} />

        <Flash ok={ok} error={error} />

        {children}
      </div>
    </StudioShell>
  );
}
