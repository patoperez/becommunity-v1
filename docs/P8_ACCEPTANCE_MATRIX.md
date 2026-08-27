# P8 final acceptance matrix

Status: **P8 accepted and closed.** Automated acceptance and the owner's
real-phone review are complete.

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
| Spanish language and landmarks | `lang="es"`, skip link, one named `main` target | Accepted in the owner pass on 2026-08-27 |
| Keyboard | global visible focus; finding/journey arrow keys; chart points; modal trap/Escape | Automated contract accepted; phone review is touch-based |
| Contrast | semantic-token and adversarial client-colour calculations | Accepted in the owner pass on 2026-08-27 |
| Meaning without colour | written state words, glyphs and chart/table alternatives | Accepted in the owner pass on 2026-08-27 |
| Reduced motion | global `prefers-reduced-motion` override | Automated contract accepted; no motion blocker reported |
| Touch targets | rendered 24 px floor; primary controls use 44 px | Accepted on a physical phone on 2026-08-27 |
| Zoom/reflow | six-width rendered matrix with no page-level overflow | Accepted on a physical phone on 2026-08-27 |

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

## Human review record

The owner completed the real-phone pass on 2026-08-27. The first pass found
that client-side interactions were not hydrating over the LAN review address,
the account row was cramped, and the relative journey scale was ambiguous.
Those findings were corrected in `8a4437a` and `b49df5d`. The owner then
re-tested the mobile product and accepted it with “todo perfecto”. Sign-in,
client navigation, finding selection, journey exploration, filters, disclosure
controls and the mobile account header were all usable. No remaining clipped
text, inaccessible action, dead end or technical-language blocker was reported.

The reviewed client fixture did not expose a qualitative word cloud, so this
record does not claim a separate visual judgment of that state. Its counted-list
fallback, accessible naming and responsive structure remain covered by the
deterministic and rendered gates. The owner explicitly accepted P8 without
holding closure for another seeded-content review.

This closes the human acceptance row and P8.
