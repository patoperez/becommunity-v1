# P8-A implementation review — the real product

> Evidence from the **running Be Community application**, not a prototype.
> Branch `p8a-product-experience-foundation`, built from the P8 discovery head
> `df35e0f`. Every screenshot below was taken from `npm start` on the built
> application, signed in with the synthetic fixture accounts, against the
> published P6E acceptance study.
>
> No prototype directory was created. No database, external system or deployment
> was touched.

> **⚠ The `.png` files in this folder are PRE-CORRECTION historical evidence.**
> They show the product at commit `73c931b`, which is what the owner reviewed.
> The corrections that review produced are in commit `1056bd6` and are **not**
> captured here — no new screenshots were taken, by instruction. Read the images
> as "what was reviewed", and the *Owner review corrections* section below as
> "what changed because of it". The live routes are the current truth.

---

## How to look at it yourself

Run it the way the repository requires — in WSL or Linux, never from Windows:

```bash
npm run build && npm start
```

Then open these routes:

| What | Route | Sign in as |
|---|---|---|
| Sign-in | `http://localhost:3000/login` | signed out |
| Client home — panorama, recorrido, voces, resultados | `http://localhost:3000/dashboard` | the tenant A test account |
| The empty client portal | `http://localhost:3000/dashboard` | the tenant B test account |
| Be Community Studio home | `http://localhost:3000/dashboard` | the internal test account |
| The client experience as an internal reviewer | `http://localhost:3000/admin/preview/<studyId>` | the internal test account |

The three test identities are the ones already in `.env.local`
(`TEST_USER_A_*`, `TEST_USER_B_*`, `TEST_INTERNAL_*`). **No password appears in
this document, in the screenshots, in the source or in any log.**

`/dashboard` is deliberately still the address for both products. Splitting it
into `/insights/**` and `/studio/**`, and adding `/acceso` so an emailed deep
link survives sign-in, is P8-B: those are route and middleware changes, and the
adversarial suites carry a frozen catalogue of the current paths.

---

## Owner review corrections (commit `1056bd6`) — not in the screenshots

The owner reviewed the running product and agreed six corrections. All six are
live at the routes above; none is reflected in the images below.

| # | Correction | What it does now |
|---|---|---|
| A | Sign-in was too long on a phone | One framed entrance. `svh` frame with `clamp`ed rhythm — fits 1366×768, 390×844 and 360×640 with no document scrollbar. No fixed pixel height and no `overflow-hidden`: each column scrolls internally if a validation error, 200 % zoom or a very short viewport genuinely needs it. Secondary copy steps aside on viewport *height*; brand, promise, both fields, submit and recovery guidance never do. |
| B | The panorama read as four equal cards | One dominant lead finding plus a compact navigator. The lead is the first finding in the order the view model already ranks results in — deterministic, never "the largest number". Selecting a secondary finding swaps value, visual, sample context, method and action in place, by pointer, Tab, arrows and Home/End. One method disclosure, not five. |
| C | The recorrido was too documentary | One drawn spine connects the touchpoints, each with its own category colour; node *shape* still carries evidence strength. The three large boxes collapse into one compact evidence area, and empty sections are omitted rather than filled with placeholders. |
| D | The identity was all navy and paper | Sky, magenta, green, yellow and lavender now carry grouping in navigation, selection, route stages and the Studio attention list. They are structurally separate from caution/danger/positive, so no number is coloured good or bad. |
| E | Studio was a static directory | The internal home opens on *¿Qué necesita atención?*, built only from state the page already loads: a study with no rows, a draft with data still unpublished, a touchpoint with no result. The four destinations remain as secondary navigation. |
| — | A published study advertised what was missing | The client view is now composed: no repeated "todavía no…". Where a study or a moment carries numbers only, one quiet sentence says so. The internal preview gets the opposite — a concise readiness notice naming what is missing, visibly marked as internal. |

---

## The eight screenshots (pre-correction)

| File | What it shows |
|---|---|
| `login--desktop.png` | The product entrance at 1440 px |
| `login--mobile.png` | The same, at 390 px |
| `client-panorama--desktop.png` | The client's first impression — findings, not tiles |
| `client-panorama--mobile.png` | The same on a phone |
| `journey-default--desktop.png` | The recorrido as first rendered |
| `journey-selected--desktop.png` | A touchpoint selected, everything updated together |
| `journey-selected--mobile.png` | The recorrido as a vertical route on a phone |
| `studio-shell--desktop.png` | Be Community Studio — the internal home |

One extra, because the review needs it: `extra-tenant-b-empty--desktop.png` —
the client portal of a tenant with nothing published.

---

## What changed

**The foundation.** The product was built on the unmodified Next.js starter
stylesheet: two colour variables, no scale, no semantic layer. There is now a
token layer that separates *brand expression* (the Be Community palette) from
*product meaning* (surface, text, line, evidence, voice, caution, danger,
positive, focus). Components only ever read meaning, which is what makes a
future co-branded or white-label study mode a re-pointing rather than a rewrite.

**The fonts actually load now.** The product was downloading two webfonts and
then shipping Arial, because a trailing `body { font-family: Arial }` won.
Bricolage Grotesque and Hanken Grotesk — the Be Community voices — are
self-hosted through `next/font`, so the strict CSP is untouched.

**A client's brand colour can no longer make text unreadable.** It used to be
painted raw behind hardcoded white text. It now passes through a contrast
resolver that picks the readable foreground and, where no foreground can rescue
the colour, moves the fill. Proved against pure white, pure black, mid grey and
every colour in the identity.

**Sign-in** reads as entering the product rather than a marketing banner
followed by a generic form. Both audiences are described by what they will
find, never by the words the system uses for them internally.

**The client home leads with findings.** The headline result used to be the
seventh thing on the page, below a stepper and some pills. Each finding now
carries a human question, visual evidence, what that evidence rests on in
ordinary words, and a way into the study — plus a slot for the consultant's
reading that the block cannot render without.

**The recorrido is a route, not a stepper.** The number under a touchpoint is
its own result. Selection works by click, tap, arrow key and tab — the old
component told the reader to *"pasa el cursor"*, which means nothing on a phone.
Evidence state is carried by shape as well as colour. Calculated evidence, what
people said, and the consultant's reading are labelled for what they are.

**Studio is its own product.** Internal staff used to land on the client product
wearing a grey "Panel interno" strip.

**Plain language.** `n=`, `unidades de respuesta`, canonical metric keys and raw
status enums no longer reach a reader. The exact base and the disclosure rule
are one click away in "cómo se calcula", not deleted.

---

## What is intentionally incomplete

1. **The consultant's reading does not exist yet.** Every place it belongs says
   so, in words, as a labelled state. P8-A adds no migration, so there is
   nowhere to store one. Building the draft → review → published flow is P8.4.
2. **`/dashboard` still serves both products.** The route split, and `/acceso`
   for surviving deep links, are P8-B.
3. **The four internal screens keep their current chrome.** `/admin/clients`,
   `/admin/studies`, `/admin/upload` and `/admin/qualitative` are unchanged
   except for a `main` landmark id. Their JSON textareas, free-text metric keys
   and `window.confirm()` are all still there — that is P8.2, and it is the
   larger of the two remaining jobs.
4. **The comparison explorer is untouched.** It still says *"Explorador de
   cruces"*, *"Filas"*, *"Columnas"*, *"Métrica"* and *"Agregación"*. This is
   deliberate: Suites B and C drive those exact control names, and Suite A parses
   the study filter's live region for `"<n> de <n> unidades de respuesta"`.
   Retiring that vocabulary needs the adversarial harness changed in the same
   commit. It is marked in the source and pinned by a gate so it cannot be
   retired by accident.
5. **The trend chart is untouched**, and does not appear at all for this study,
   which has one period.
6. **Dark mode is retired, not ported.** It was half-built: `dark:` variants
   everywhere while the two branded surfaces ignored the mode, so a client on a
   dark phone got a light hero inside a near-black page. The variant is
   re-pointed at a class the product never sets, so every existing `dark:`
   utility is inert and a real dark theme remains possible later.
7. **The PDF is unchanged.**

---

## Measured in the running application

| Check | Result |
|---|---|
| Horizontal overflow, client home | none at 1440, 768, 390 or 320 px |
| Horizontal overflow, sign-in | none at 320 px |
| Keyboard — recorrido | `ArrowRight` moved selection and focus 0 → 1; `ArrowLeft` moved both back |
| Visible focus | `solid 3px rgb(23, 99, 148)` on the touchpoint control |
| Skip link | reachable by keyboard, visible on focus, and `#contenido` exists |
| Document language | `lang="es"` |
| Shipped body font | `"Hanken Grotesk"` — the Arial override is gone |
| `prefers-reduced-motion: reduce` | every transition collapses to ~0 s and selection still works |
| Contrast | every text token ≥ 4.5:1 on white, paper and sunken; brand resolver ≥ 4.5:1 for eleven adversarial colours |

Gates, all in WSL: `typecheck` 0 · `lint` 0 errors (55 pre-existing warnings in
`scripts/`) · `npm test` 0, 27 gates · `npm run build` 0.

---

## One design-review pass, and what it changed

The eight screenshots were reviewed once against the brief, and one bounded
correction pass followed. The five findings:

1. **A number was drawn against a scale the product does not know.** The
   touchpoint *Confianza* averages **7.5** on the client's own instrument, and
   the bar assumed a 1–5 scale — so it rendered pinned at the far right, looking
   like a near-perfect result. A right number under a wrong denominator is
   exactly the failure this phase exists to remove. An absolute track is now
   drawn only for the two measures that genuinely have a domain (recomendación,
   −100 to 100; porcentaje, 0 to 100). A plain average is compared against its
   own peers, and the caption says so: *"de 7.5 a 8.4, no contra un máximo."*
2. *"Satisfacción · Sat general"* repeated the measurement inside its own
   subject. Now *"Satisfacción · General"*.
3. The route line vanished where it crossed the selected touchpoint.
4. Studio's navigation had no current-location indicator on the page it was
   rendering, because "Inicio" was not one of its stops.
5. The study-base sentence read as a fragment on a small base.

**A note on the harness, because it matters for how you read this.** The first
mobile capture came back showing the error boundary. It was not a product
defect: the screenshot harness proxied the app on a second port, which made the
request's `Origin` disagree with its `Host`, and Next refused the dashboard's
own Server Action with *"Invalid Server Actions request"*. The CSRF guard was
right and the harness was wrong. The harness now puts a real session on the real
origin, and it fails loudly if any captured page renders the error boundary — so
a broken screen can never again be filed as a good screenshot.

---

## Six questions for you

1. **Is the finding the right unit?** Each card is one question, one number, one
   piece of evidence, one way in. Is that what a school director should meet
   first — or should the panorama open with one single headline and push the
   rest below?

2. **"El más bajo" — too strong, or not strong enough?** The product currently
   states a fact and refuses to judge it: it marks the lowest of the touchpoints
   that share a scale and says explicitly that being lowest does not mean it is
   wrong. Your per-client thresholds (decision D4) would replace this with a
   real *outside the ideal* alert. Should P8-B bring those thresholds forward?

3. **Result names come from the data file.** This study produced *"Satisfacción
   · General"*, *"Satisfacción · Maestros"* and *"Confianza"* from its column
   names, and the characteristics read *"genero"* and *"nivel"* — unaccented,
   because that is how the column is spelled. Should Studio let you give each
   result and characteristic a display name the client sees, or should the
   import step enforce clean names?

4. **How much should the client see of what is missing?** The recorrido says out
   loud when nobody commented on a touchpoint and when no reading is published.
   Is that honesty reassuring, or does it read as an unfinished product to a
   client who is paying for it?

5. **Studio's four destinations.** They are currently *Estudios y plantillas ·
   Carga de datos · Lo que dijeron las personas · Clientes y accesos*, with
   client administration demoted to a secondary link. Does that match how you
   actually start your day, or should the home open on "what needs me now"
   instead — studies awaiting review, imports left staged, comments still
   pending?

6. **Which comes next, P8.2 or P8.3?** P8.2 removes the JSON textarea, the
   typed metric keys and the retyped theme names from Studio — it stops you
   being able to quietly break your own study. P8.3 finishes the client story —
   the comparison view, the trend view and the voces view in the new language.
   The audit says P8.2 is the bigger risk; you may feel the client-facing
   payoff matters more first.
