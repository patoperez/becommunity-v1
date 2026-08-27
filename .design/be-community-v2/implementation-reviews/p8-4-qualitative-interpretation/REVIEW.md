# P8.4 implementation review

Status: implementation complete; owner review pending.

## What changed

- Studio gained a structured **Lectura del equipo** step: private draft,
  visible review state, approval, publication and withdrawal.
- Publishing copies the approved draft into a separate client snapshot. Saving
  a later draft does not change what the client already sees.
- Insights and the PDF read only the published snapshot. Missing or withdrawn
  interpretation produces no client placeholder.
- Confirmed qualitative themes retain their ranked counted list and gain an
  optional SVG word cloud with image download.
- Client defaults flow into studies; explicit study settings override them.
  Ordinary controls cover palette, cover copy, visible modules, journey setup
  and one focused threshold alert. Templates preserve that configuration.
- Templates are shared across the internal team and show their author.

## Data and authorization boundary

- Migration `0017` owns interpretation state and its append-only transition
  events. Browser roles cannot read either table; the existing authenticated
  Server Action proves the internal role before calling the service-only RPC.
- Posted evidence is schema-bounded and matched back to the study's current
  metric, journey and confirmed-theme inventory; canonical server labels are
  stored instead of browser-posted labels.
- Migration `0018` changes only the existing internal template RPCs. It does
  not add a role or expose templates to client browser access.
- Neither migration changes calculations, canonical rows, ingestion semantics,
  study publication, client scope or the P7 adversarial boundary.

## Automated evidence

- `npm run test:p8-qualitative`: 28 deterministic checks.
- `npm run test:p8-qualitative-live`: full disposable lifecycle including the
  independent published snapshot and zero-residue cleanup.
- `npm test`, build and the canonical offline chain are recorded on the final
  commit in the delivery report.

## Owner review

1. In a Studio study, open **Lectura del equipo**. Save the three-part reading,
   select evidence, send it to review, approve and publish it.
2. Open the client preview. Confirm that the published reading is present and
   that no draft/review language reaches the client.
3. Edit and save a new draft. Confirm the preview still shows the earlier
   published reading until the new version is approved and published.
4. Withdraw the reading. Confirm the client receives silence, not an empty
   card or a message saying something is missing.
5. In qualitative results, switch between the counted list and word cloud;
   download the image and confirm the list remains the numerical reference.
6. Set client presentation defaults, then override one study. Confirm the study
   inherits until the override is deliberate and that a template carries it.
7. Set a threshold that is inside and then outside the result. Confirm exactly
   one alert appears only outside the ideal range.

No screenshots were produced, by owner request.
