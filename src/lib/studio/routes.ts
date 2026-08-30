/**
 * Studio's addresses, in one place (P8.2).
 *
 * Two things depend on this module being the only source of a Studio URL.
 *
 * ROUTE COMPATIBILITY. Every `/admin/*` address the product has ever had keeps
 * working: bookmarks, emailed links and the frozen adversarial catalogue all
 * point at them, and none of that may break because the navigation got better
 * names. `/studio/*` is an addition, never a replacement, and `ADMIN_ALIASES`
 * records the pairing so a gate can assert it.
 *
 * SAFE RETURN PATHS. A Server Action shared by two addresses has to send the
 * operator back to the one they came from. The path is never echoed from the
 * request: the action BUILDS the small set of paths that are legitimate for the
 * object it just acted on and accepts a submitted value only when it is one of
 * them. An attacker-supplied `return_to` therefore cannot become a redirect
 * target, because it is compared against constructed strings rather than
 * pattern-matched.
 */

export const STUDIO_ROOT = "/studio";
export const STUDIO_CLIENTS = "/studio/clientes";
export const STUDIO_STUDIES = "/studio/estudios";
export const STUDIO_TEMPLATES = "/studio/plantillas";

export const studioClient = (tenantId: string) => `/studio/clientes/${tenantId}`;
export const studioStudy = (studyId: string) => `/studio/e/${studyId}`;
export const studioStudyData = (studyId: string) => `/studio/e/${studyId}/datos`;
export const studioStudyCategories = (studyId: string) => `/studio/e/${studyId}/categorias`;
export const studioStudyIndicators = (studyId: string) => `/studio/e/${studyId}/indicadores`;
export const studioStudyQualitative = (studyId: string) => `/studio/e/${studyId}/cualitativo`;
export const studioStudyInterpretation = (studyId: string) => `/studio/e/${studyId}/interpretacion`;
export const studioStudyPreview = (studyId: string) => `/studio/e/${studyId}/vista-cliente`;
export const studioStudyPublish = (studyId: string) => `/studio/e/${studyId}/publicar`;
/**
 * The Experience Composer prototype. Internal, experimental, and deliberately
 * NOT one of the study's process steps: it saves nothing and publishes nothing,
 * so putting it in the row a consultant follows would misdescribe it. It has an
 * address so it can be linked and tested, and no more than that.
 */
export const studioStudyComposer = (studyId: string) => `/studio/e/${studyId}/construccion`;

/**
 * THE INTERNAL PREVIEW OF THE COMPOSED DRAFT — and the reason it is a separate
 * address from `studioStudyPreview`.
 *
 * `vista-cliente` shows the experience the client is being served TODAY. It
 * deliberately does not read a composed draft, which is correct and is what
 * makes it a truthful picture of what the client currently sees — and which
 * made it useless for judging work in progress, because every change the
 * builder saved was invisible there. Offering one button called "Vista del
 * cliente" for both questions was the mistake: it implied the client dashboard
 * should already contain the draft.
 *
 * `vista-previa` renders the LATEST SAVED DRAFT with the study's real
 * aggregates, for internal users only, and publishes nothing. Two addresses,
 * two questions, two labels:
 *
 *   Vista previa del borrador       -> here; what the work looks like now
 *   Ver versión actualmente publicada -> vista-cliente; what the client has
 */
export const studioStudyDraftPreview = (studyId: string) => `/studio/e/${studyId}/vista-previa`;

/** The legacy address each Studio surface continues to answer at. */
export const ADMIN_ALIASES: { studio: string; admin: string }[] = [
  { studio: STUDIO_ROOT, admin: "/dashboard" },
  { studio: STUDIO_CLIENTS, admin: "/admin/clients" },
  { studio: STUDIO_STUDIES, admin: "/admin/studies" },
  { studio: STUDIO_TEMPLATES, admin: "/admin/studies" },
];

/**
 * Where a Server Action returns after acting on a study.
 *
 * `allowed` is built by the caller from ids it has already validated, so this
 * function only ever compares whole strings. There is no prefix test, no
 * `startsWith`, and no way for a submitted value to introduce a host.
 */
export function safeReturnPath(
  submitted: unknown,
  allowed: readonly string[],
  fallback: string,
): string {
  const value = String(submitted ?? "");
  return allowed.includes(value) ? value : fallback;
}

/** Every Studio address that may host the qualitative review of one study. */
export function qualitativeReturnPaths(studyId: string): string[] {
  return [studioStudyQualitative(studyId)];
}

export function interpretationReturnPaths(studyId: string): string[] {
  return [studioStudyInterpretation(studyId)];
}

/** Every Studio address that may host the category review of one study. */
export function categoryReturnPaths(studyId: string): string[] {
  return [studioStudyCategories(studyId)];
}

/** Every Studio address that may host the configuration of one study. */
export function studyConfigurationReturnPaths(studyId: string): string[] {
  return [studioStudy(studyId), studioStudyIndicators(studyId), studioStudyPublish(studyId)];
}

/** Every Studio address that may host the template library. */
export function templateReturnPaths(): string[] {
  return [STUDIO_TEMPLATES];
}

/** Every Studio address that may host client administration. */
export function clientReturnPaths(tenantId: string | null): string[] {
  return tenantId ? [STUDIO_CLIENTS, studioClient(tenantId)] : [STUDIO_CLIENTS];
}
