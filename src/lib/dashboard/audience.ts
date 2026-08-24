/**
 * Who is reading this study view.
 *
 * `client`  — the published experience. It is a composed piece of work: it
 *             shows what is ready and says nothing about what the consultancy
 *             has not finished. Absence of *evidence* is still disclosed
 *             honestly (a weak base, a suppressed result, a touchpoint with no
 *             data), because that is a property of the study. Absence of
 *             *consultancy work in progress* is not the client's business.
 *
 * `preview` — the internal render of that same experience, at
 *             `/admin/preview/[studyId]`. It gets a concise readiness notice
 *             naming what is still missing before publication, visibly marked
 *             as internal so it can never be mistaken for client content.
 *
 * This is a PRESENTATION distinction only. It changes no query, no
 * authorization, no calculation and no disclosure threshold — the internal
 * preview already required the `internal` role server-side, and still does.
 */
export type Audience = "client" | "preview";
