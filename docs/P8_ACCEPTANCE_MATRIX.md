# P8 final acceptance matrix

Status: automated acceptance complete. Revisión humana en teléfono real: pendiente.

This is the final P8 acceptance contract. It records what automation can prove
and keeps the owner's real-device judgment separate; a browser script is not a
person and cannot approve the experience on her behalf.

## Responsive matrix

The rendered gate exercises **320 px, 360 px, 390 px, 768 px, 1024 px and
1280 px**. It covers the signed-in client home and study detail, Studio home,
studies, clients, templates and every step of one real study. At each width it
requires:

- no document-level horizontal scrolling;
- no content outside the viewport unless it belongs to an explicit internal
  scroller;
- no clipped leaf text;
- controls at least 24 × 24 CSS pixels, with the product's primary controls
  retaining their 44 px target;
- no duplicate DOM identifiers;
- every image and data SVG to have an accessible name;
- the account and primary navigation to remain present.

The earlier 258 px probe remains a non-contract stress diagnostic. The product
floor is 320 px; narrow captions nevertheless use safe wrapping rather than
silently clipping.

## Accessibility matrix

| Concern | Automated evidence | Human evidence |
|---|---|---|
| Spanish language and landmarks | `lang="es"`, skip link, one named `main` target | Pending |
| Keyboard | global visible focus; finding/journey arrow keys; chart points; modal trap/Escape | Pending |
| Contrast | semantic-token and adversarial client-colour calculations | Pending |
| Meaning without colour | written state words, glyphs and chart/table alternatives | Pending |
| Reduced motion | global `prefers-reduced-motion` override | Pending |
| Touch targets | rendered 24 px floor; primary controls use 44 px | Pending |
| Zoom/reflow | six-width rendered matrix with no page-level overflow | Pending |

## State matrix

| Product area | Carga | Vacío | Error | No encontrado | Sin permiso |
|---|---|---|---|---|---|
| Insights home/detail | Named loading state | Published-study empty state; unpublished content is silent | Recoverable Insights boundary | Insights-specific route recovery | Server redirect/denial before data |
| Studio home/lists | Authentication completes before any streamed loading UI; task controls name their pending state | Named list/work state with next action | Recoverable Studio boundary | Studio-specific route recovery | Internal guard redirects before reads |
| Study workflow | Authentication first; task controls name their pending state | Each step names an honest next action | Parent recovery with saved-work assurance | Stable studies/home exits | Internal guard on every route |
| Client preview | Parent Studio state plus internal notice | Internal-only readiness; client absence remains silent | Parent Studio recovery | Stable studies/home exits | Internal guard before preview data |

## Plain-language contract

Ordinary interfaces do not ask a person to understand JSON, UUIDs, canonical
keys, stored status values or a “pivot”. Methodological terms may appear only
inside a deliberate explanation. Stored field names and machine payloads stay
behind the application boundary.

## Human review still required

On a real phone, the owner must still confirm: the sign-in fits without losing
its action; Studio navigation feels understandable rather than merely fitting;
the client story is pleasant to explore; the word cloud is readable and useful;
focus order follows the visual order; browser text zoom remains usable; and no
important action feels too small. Record that pass here after it actually
happens. Until then P8.5 is automated-acceptance-complete, not human-approved.
