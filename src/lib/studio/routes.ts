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
export const studioStudyIndicators = (studyId: string) => `/studio/e/${studyId}/indicadores`;
export const studioStudyQualitative = (studyId: string) => `/studio/e/${studyId}/cualitativo`;
export const studioStudyInterpretation = (studyId: string) => `/studio/e/${studyId}/interpretacion`;
/**
 * The canonical composer (Unit 6B.1).
 *
 * Declared AFTER `studioStudyInterpretation` and BEFORE `studioStudyPreview`
 * on purpose: `scripts/p8-final-acceptance-test.mjs` matches this file against
 * an order-sensitive pattern requiring interpretation → preview → publish, and
 * an addition between two of them keeps that order rather than breaking it.
 */
export const studioStudyConstruction = (studyId: string) => `/studio/e/${studyId}/construccion`;
/**
 * The canonical publication review (Unit 6B.4A).
 *
 * Between the composer and the client preview, because reviewing a composed
 * presentation is what turns one into something a client can be served. It is
 * declared BEFORE `studioStudyPreview` for the same reason the composer is:
 * `scripts/p8-final-acceptance-test.mjs` matches this file against an
 * order-sensitive pattern requiring interpretation, then preview, then publish,
 * and an addition between two of them keeps that order rather than breaking it.
 *
 * IT IS NOT `studioStudyPublish`. That address moves the STUDY between draft,
 * published and archived — who may open the portal at all — and this one decides
 * which canonical presentation a client is served inside it. Two different
 * decisions, two surfaces, and collapsing them would make one of the two
 * invisible.
 */
export const studioStudyReview = (studyId: string) => `/studio/e/${studyId}/revision`;
/**
 * The journey pain editor (Unit 6B.4B2C).
 *
 * INSIDE the review's own segment, and declared immediately after it, because
 * it is a part of that review rather than a sixth process step: a person opens
 * it from the review, decides, and comes back. It is deliberately NOT in the
 * study's process navigation — adding a step there would tell every study it
 * has journey pain material, and most do not.
 */
export const studioStudyJourneyPain = (studyId: string) => `/studio/e/${studyId}/revision/dolor`;
export const studioStudyPreview = (studyId: string) => `/studio/e/${studyId}/vista-cliente`;
export const studioStudyPublish = (studyId: string) => `/studio/e/${studyId}/publicar`;

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
