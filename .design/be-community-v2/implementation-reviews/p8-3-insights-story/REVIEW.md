# P8.3 implementation review — Insights data story

Status: implementation-complete; owner review pending.

## What to review

- `/insights`: compact study library and the latest study panorama.
- `/insights/e/[studyId]`: one complete study, persistent URL filters and the
  matching filtered report.
- `Compara por...`: plain-language controls over the unchanged server-side
  pivot calculation and allowlist.
- `Cómo ha cambiado`: list for two or three periods, chart from four periods,
  and a table alternative in both cases.
- Privacy/sample language: ordinary Spanish on screen and in the PDF; exact
  counts remain in method disclosures where permitted.
- Loading, malformed links, forbidden studies, invalid filters and recoverable
  calculation failures.

## Deliberate boundary

P8.3 reserves a typed consultant-interpretation slot in each finding but does
not invent a reading or a storage model. The client sees silence when that slot
is empty. Authoring, approval and publication of interpretations belong to
P8.4.

## Technical invariants

No calculation, ingestion adapter, canonical row shape, RLS policy, role,
migration or publication rule changed. Screen and report use the same bounded
`f.*` filter grammar. The existing adversarial filter and pivot mechanisms stay
intact.

## Verification

No screenshots were produced, at the owner's request. Automated evidence is
recorded by `test:insights-story`, the adjacent longitudinal, narrative, pivot,
PDF, design-token, publication and data-scope gates, and the canonical Linux
offline chain.
