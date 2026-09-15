/**
 * Be Community — UNIT 6B.4B2L: migration 0034's category ledger, against a real
 * PostgreSQL and a real PostgREST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT PROVES, AND WHY EACH ONE NEEDS A REAL STACK.
 *
 *  [1] THE OBJECT IS LOCKED DOWN. RLS enabled and forced, an explicit deny for
 *      the browser roles, `service_role` holding SELECT and nothing else, and
 *      the write and read functions revoked from PUBLIC, `anon` and
 *      `authenticated`. Read off `pg_catalog`, not off the migration text.
 *
 *  [2] THE WRITE PATH ENFORCES ITS OWN RULES. An actor who is not internal, an
 *      unsorted member list, a grouping with no name, a postponement with no
 *      reason, an undo of nothing — every one refused by the database, with the
 *      code the application maps.
 *
 *  [3] THE THREE GROUPING RULES ARE SQL, NOT INTERFACE. A label already in
 *      another category, a name already taken, and a name that is a member of
 *      another group: all three refused by the function.
 *
 *  [4] A REPLAY IS NOT A SECOND DECISION, and a stale screen is refused. The
 *      identical decision in force returns `created: false` and writes no row;
 *      a decision taken against a version that has moved raises 55000.
 *
 *  [5] THE LEDGER IS IMMUTABLE AT THE TRIGGER. UPDATE and DELETE both raise
 *      2F002 while the study exists.
 *
 *  [6] NOTHING ELSE MOVES. Every table's row count is compared before and
 *      after, so «it writes only its own table» is measured rather than read.
 *
 *  [7] THE PROJECTION CHANGES CATEGORIES AND NOT ANSWERS. The real row set is
 *      read, the real results are built twice — once with the ledger's
 *      projection and once without — and the totals, bases and absence states
 *      are compared.
 *
 *  [8] A CATEGORY CHANGE INVALIDATES THE QUALITATIVE SIGN-OFF BY ITSELF. The
 *      real `qualitativeEvidenceDigest` is computed over the bound groups
 *      before and after, and the real `qualitativeReviewState` is asked.
 *
 *  [9] A BROWSER CANNOT CALL EITHER FUNCTION, over real HTTP, and a caller
 *      naming another tenant's study gets nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TOUCHES NO HOSTED PROJECT. `resolveDisposableTarget` refuses to run if a
 * Supabase variable is in scope, and every byte below lives in a database this
 * script creates and drops.
 */

import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import {
  foldCategoryLabel,
  resolutionFrom,
  sortedFolds,
} from "../src/lib/category-review/index.ts";
import { categorySourceDigest } from "../src/lib/category-review/digest.ts";
import {
  qualitativeEvidenceDigest,
  qualitativeReviewState,
} from "../src/lib/publication/evidence-digest.ts";

let failures = 0;
let executed = 0;
let skipped = 0;
const check = (condition, message) => {
  executed += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.log(`  ✗ FALLO: ${message}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (fue ${JSON.stringify(actual)})`}`,
  );

const TENANT = "00000000-0000-4000-8000-0000000011a1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000011a2";
const STUDY = "00000000-0000-4000-8000-0000000021b1";
const OTHER_STUDY = "00000000-0000-4000-8000-0000000021b2";
const INTERNAL = "00000000-0000-4000-8000-0000000031c1";
const CLIENT_A = "00000000-0000-4000-8000-0000000031c2";
const PASSWORD = "contrasena-de-un-solo-uso-9d41";
const POSTGREST =
  process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const arr = (values) => `array[${values.map((v) => q(v)).join(", ")}]::text[]`;
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

let target;
try {
  target = resolveDisposableTarget(process.env);
} catch (thrown) {
  if (thrown instanceof DisposableTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

console.log("Be Community — Unit 6B.4B2L: the canonical category ledger, live");
console.log("=".repeat(86));

await withDisposableDatabase(target, "categoryreview", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0034, two tenants, one committed package");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(34);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'Comunidad Uno'),
      (${q(OTHER_TENANT)}, 'Comunidad Dos');
    insert into auth.users (id, email) values
      (${q(INTERNAL)}, 'interno@categorias.local'),
      (${q(CLIENT_A)}, 'cliente@categorias.local');
    insert into public.profiles (user_id, tenant_id, role, full_name) values
      (${q(INTERNAL)}, ${q(TENANT)}, 'internal', 'Persona interna'),
      (${q(CLIENT_A)}, ${q(TENANT)}, 'client', 'Cliente autorizado');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio categorizado', 'draft'),
      (${q(OTHER_STUDY)}, ${q(OTHER_TENANT)}, 'Estudio ajeno', 'draft');
  `);

  const pack = await buildSyntheticPackage();
  const committed = await runCanonicalCommit(transport, {
    tenantId: TENANT,
    studyId: STUDY,
    files: [
      { fileName: "limpios.xlsx", bytes: pack.cleanBytes },
      { fileName: "curado.xlsx", bytes: pack.painBytes },
    ],
  });
  if (!committed.ok) throw new Error(`the synthetic package did not commit: ${committed.code}`);

  /** Every table's row count, so «nothing else moved» is measured. */
  const inventory = () =>
    db.json(`
      select coalesce(jsonb_object_agg(t.table_name, t.n), '{}'::jsonb) from (
        select c.relname as table_name,
               (xpath('/row/c/text()', query_to_xml(
                 format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint as n
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relkind = 'r'
      ) t;
    `);

  const decide = (over = {}) => {
    const input = {
      family: "activos",
      folds: ["a", "b"],
      labels: ["A", "B"],
      digest: DIGEST_A,
      disposition: "grouped",
      label: "Nombre final",
      fold: "nombre final",
      rationale: null,
      expected: null,
      actor: INTERNAL,
      ...over,
    };
    return db.json(`
      select public.record_canonical_category_decision(
        ${q(STUDY)}, ${q(input.actor)}, ${q(input.family)},
        ${arr(input.folds)}, ${arr(input.labels)}, ${q(input.digest)},
        ${q(input.disposition)}, ${q(input.label)}, ${q(input.fold)},
        ${q(input.rationale)}, ${input.expected === null ? "null" : Number(input.expected)}
      );
    `);
  };
  /**
   * The DATABASE's own sentence, not the runner's.
   *
   * `db.json` throws an Error whose `message` is «psql refused a statement
   * (sqlstate NNNNN)» and whose `databaseMessage` carries what PostgreSQL
   * actually said. Reading `message` would make every refusal look alike, so a
   * check that meant to prove WHICH rule refused would pass on any refusal at
   * all — including one caused by the test's own mistake.
   */
  const decideExpectingError = (over = {}) => {
    try {
      decide(over);
      return null;
    } catch (thrown) {
      return `${thrown?.sqlstate ?? ""} ${thrown?.databaseMessage ?? thrown?.message ?? thrown}`;
    }
  };

  /* ------------------------------------------------------------------------ */
  console.log("\n[1] La tabla está cerrada, y las funciones también");
  {
    const rls = db.json(`
      select jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity,
                                'acl', coalesce(array_to_json(c.relacl)::jsonb, '[]'::jsonb))
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'canonical_category_decision';
    `);
    check(rls?.enabled === true, "RLS activado");
    check(rls?.forced === true, "y forzado");
    const acl = (rls?.acl ?? []).map(String);
    check(
      acl.some((entry) => /^service_role=r\//.test(entry)),
      `service_role sólo puede leer (acl ${JSON.stringify(acl)})`,
    );
    check(!acl.some((entry) => /^anon=|^authenticated=|^=/.test(entry)), "y ni anon ni authenticated ni PUBLIC tienen nada");

    const policy = db.json(`
      select coalesce(jsonb_agg(jsonb_build_object('name', polname, 'roles', pg_catalog.array_to_json(polroles::regrole[])::jsonb)), '[]'::jsonb)
        from pg_policy p join pg_class c on c.oid = p.polrelid
       where c.relname = 'canonical_category_decision';
    `);
    check(Array.isArray(policy) && policy.length === 1, `una sola política (${policy?.length ?? 0})`);
    check(policy?.[0]?.name === "deny_browser_roles", "y es la negativa explícita a los roles del navegador");

    for (const [name, wantStable] of [
      ["record_canonical_category_decision", false],
      ["read_canonical_category_decisions", true],
      ["refuse_canonical_category_change", false],
    ]) {
      const meta = db.json(`
        select jsonb_build_object('volatility', p.provolatile, 'definer', p.prosecdef,
                                  'config', coalesce(to_jsonb(p.proconfig), 'null'::jsonb),
                                  'acl', coalesce(array_to_json(p.proacl)::jsonb, '[]'::jsonb),
                                  'args', pg_get_function_arguments(p.oid))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = ${q(name)};
      `);
      check(meta !== null, `${name} existe`);
      check(
        Array.isArray(meta?.config) && meta.config.some((entry) => /^search_path=(""|'')?$/.test(String(entry))),
        `${name} fija search_path a vacío`,
      );
      if (wantStable) eq(`${name} es stable`, meta?.volatility, "s");
      const acl = (meta?.acl ?? []).map(String);
      check(!acl.some((entry) => /^=|^anon=|^authenticated=/.test(entry)), `${name}: ni PUBLIC ni anon ni authenticated pueden ejecutarla`);
    }

    // A FABRICATED COUNT HAS NOWHERE TO TRAVEL. The write function takes labels,
    // a disposition, a name, a reason and a version — and no count, no share,
    // no total and no digest the caller computed.
    const args = String(
      db.json(`
        select to_jsonb(pg_get_function_arguments(p.oid))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'record_canonical_category_decision';
      `),
    );
    check(!/count|total|share|percent/i.test(args), `la función de escritura no acepta ningún conteo (${args.slice(0, 60)}…)`);
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[2] La escritura hace cumplir sus propias reglas");
  const before = inventory();
  {
    check(
      (decideExpectingError({ actor: CLIENT_A }) ?? "").includes("internal actor required"),
      "un actor que no es interno es rechazado",
    );
    check(
      (decideExpectingError({ folds: ["b", "a"] }) ?? "").includes("sorted and unique"),
      "una lista de miembros sin ordenar es rechazada",
    );
    check(
      (decideExpectingError({ folds: ["a"], labels: ["A"] }) ?? "").includes("at least two"),
      "una sola categoría es rechazada",
    );
    check(
      (decideExpectingError({ label: null, fold: null }) ?? "").includes("final name"),
      "agrupar sin nombre es rechazado",
    );
    check(
      (decideExpectingError({ disposition: "postponed", label: null, fold: null, rationale: "corto" }) ?? "").includes(
        "at least ten",
      ),
      "posponer sin explicación es rechazado",
    );
    check(
      (decideExpectingError({ disposition: "revoked", label: null, fold: null }) ?? "").includes("nothing to undo"),
      "deshacer lo que nadie decidió es rechazado",
    );
    check(
      (decideExpectingError({ digest: "no-es-una-huella" }) ?? "").includes("source digest"),
      "una huella con forma equivocada es rechazada",
    );
    check(
      (decideExpectingError({ labels: ["A"] }) ?? "").includes("disagree"),
      "una lista de escrituras de otro tamaño es rechazada",
    );
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[3] Una decisión, su historia y su réplica");
  {
    const first = decide({ expected: 0 });
    eq("la primera versión es la uno", first?.version, 1);
    eq("y se creó", first?.created, true);

    const replay = decide({ expected: 1 });
    eq("la misma decisión se devuelve", replay?.created, false);
    eq("con su versión intacta", replay?.version, 1);
    eq("y no escribió una segunda fila", db.json(`select to_jsonb(count(*)) from public.canonical_category_decision;`), 1);

    // A RENAME IS A NEW VERSION, and it keeps the category's identity.
    const renamed = decide({ expected: 1, label: "Otro nombre", fold: "otro nombre" });
    eq("renombrar crea la versión dos", renamed?.version, 2);
    const keys = db.json(`
      select coalesce(jsonb_agg(distinct canonical_key), '[]'::jsonb) from public.canonical_category_decision;
    `);
    eq("y la identidad estable no se reasigna al renombrar", keys.length, 1);

    // THE VERSION THE SCREEN SHOWED IS CHECKED.
    check(
      (decideExpectingError({ expected: 1, label: "Tercero", fold: "tercero" }) ?? "").includes("while the screen was open"),
      "una decisión tomada sobre una versión que ya se movió es rechazada",
    );

    // AND A DECISION AGAINST A FAMILY THAT MOVED IS A NEW DECISION, not a replay.
    const moved = decide({ expected: 2, digest: DIGEST_B, label: "Otro nombre", fold: "otro nombre" });
    eq("la misma decisión sobre otra lista de categorías sí se escribe", moved?.created, true);
    eq("como versión tres", moved?.version, 3);

    const history = db.json(`
      select coalesce(jsonb_agg(jsonb_build_object('v', version, 'd', disposition) order by version), '[]'::jsonb)
        from public.canonical_category_decision;
    `);
    eq("la historia completa está en la tabla", history.length, 3);
    check(
      history.every((row, index) => row.v === index + 1),
      "con una cadena de versiones sin huecos",
    );

    const undone = decide({ expected: 3, disposition: "revoked", label: null, fold: null });
    eq("deshacer escribe la versión cuatro", undone?.version, 4);
    const inForce = db.json(`select public.read_canonical_category_decisions(${q(STUDY)}, ${q(TENANT)});`);
    eq("y la lectura devuelve una sola decisión en vigor", inForce.decisions.length, 1);
    eq("que es la revocación", inForce.decisions[0].disposition, "revoked");
    eq("de la versión cuatro", inForce.decisions[0].version, 4);
    check(
      resolutionFrom(inForce.decisions).groups.activos === undefined,
      "y una revocación no proyecta nada",
    );
    check(!("decidedBy" in inForce.decisions[0]), "la lectura nunca devuelve quién decidió");
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[4] Las tres reglas de una agrupación plana son SQL");
  {
    // A FAMILY OF ITS OWN, because the ledger is immutable: there is no DELETE
    // path to clear the previous section's rows, and reaching for one would be
    // reaching for the property this table exists to have.
    const R = { family: "reglas" };
    decide({ ...R, folds: ["dos", "uno"], labels: ["Dos", "Uno"], label: "Primera", fold: "primera", expected: 0 });

    check(
      (decideExpectingError({ ...R, folds: ["dos", "tres"], labels: ["Dos", "Tres"], label: "Segunda", fold: "segunda", expected: 0 }) ?? "").includes(
        "already belongs to",
      ),
      "una respuesta ya agrupada en otra categoría",
    );
    check(
      (decideExpectingError({ ...R, folds: ["cuatro", "tres"], labels: ["Cuatro", "Tres"], label: "Primera", fold: "primera", expected: 0 }) ?? "").includes(
        "already exists here",
      ),
      "un nombre que ya existe en la familia",
    );
    check(
      (decideExpectingError({ ...R, folds: ["cuatro", "tres"], labels: ["Cuatro", "Tres"], label: "Uno", fold: "uno", expected: 0 }) ?? "").includes(
        "already grouped inside",
      ),
      "y un nombre que ya es miembro de otro grupo",
    );

    // A DIFFERENT FAMILY IS A DIFFERENT QUESTION: the same name there is fine.
    const elsewhere = decide({
      family: "desertores",
      folds: ["cinco", "seis"],
      labels: ["Cinco", "Seis"],
      label: "Primera",
      fold: "primera",
      expected: 0,
    });
    eq("la misma etiqueta en otra familia se acepta", elsewhere?.created, true);
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[5] El registro es inmutable, y sólo mientras el estudio existe");
  {
    let updateError = null;
    try {
      db.run(`update public.canonical_category_decision set rationale = 'editado';`);
    } catch (thrown) {
      updateError = String(thrown?.databaseMessage ?? thrown?.message ?? thrown);
    }
    check((updateError ?? "").includes("immutable"), "UPDATE es rechazado por el disparador");

    let deleteError = null;
    try {
      db.run(`delete from public.canonical_category_decision where version = 1;`);
    } catch (thrown) {
      deleteError = String(thrown?.databaseMessage ?? thrown?.message ?? thrown);
    }
    check((deleteError ?? "").includes("cannot be deleted"), "y DELETE también, mientras el estudio exista");
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[6] Un estudio ajeno no se alcanza, y la memoria no cruza inquilinos");
  {
    // The read names both ids, and the study row is what resolves them: a caller
    // naming the right study under the wrong tenant selects nothing.
    const crossed = db.json(`select public.read_canonical_category_decisions(${q(STUDY)}, ${q(OTHER_TENANT)});`);
    eq("otro inquilino no ve una sola decisión", crossed.decisions.length, 0);
    eq("ni una sola memoria", crossed.memory.length, 0);

    const wrongStudy = db.json(`select public.read_canonical_category_decisions(${q(OTHER_STUDY)}, ${q(TENANT)});`);
    eq("y un estudio de otro inquilino tampoco", wrongStudy.decisions.length, 0);

    // A decision in another study OF THE SAME TENANT is recalled as memory.
    const SIBLING = "00000000-0000-4000-8000-0000000021b3";
    db.run(`
      insert into public.study (id, tenant_id, name, status)
      values (${q(SIBLING)}, ${q(TENANT)}, 'Estudio hermano', 'draft');
      insert into public.canonical_category_decision
        (study_id, tenant_id, family_key, member_folds, member_labels, source_digest,
         disposition, canonical_key, canonical_label, canonical_fold, version, decided_by)
      values (${q(SIBLING)}, ${q(TENANT)}, 'activos', ${arr(["dos", "uno"])}, ${arr(["Dos", "Uno"])},
              ${q(DIGEST_A)}, 'grouped', 'recordada', 'Recordada', 'recordada', 1, ${q(INTERNAL)});
    `);
    const recalled = db.json(`select public.read_canonical_category_decisions(${q(STUDY)}, ${q(TENANT)});`);
    check(recalled.memory.length === 1, `otro estudio del MISMO cliente se recuerda (${recalled.memory.length})`);
    eq("con el nombre que allá se eligió", recalled.memory[0]?.canonicalLabel, "Recordada");
    check(
      !recalled.decisions.some((entry) => entry.canonicalLabel === "Recordada"),
      "y la memoria NO entra entre las decisiones en vigor de este estudio",
    );

    // Another TENANT's decision is never recalled.
    db.run(`
      insert into public.canonical_category_decision
        (study_id, tenant_id, family_key, member_folds, member_labels, source_digest,
         disposition, canonical_key, canonical_label, canonical_fold, version, decided_by)
      values (${q(OTHER_STUDY)}, ${q(OTHER_TENANT)}, 'activos', ${arr(["dos", "uno"])}, ${arr(["Dos", "Uno"])},
              ${q(DIGEST_A)}, 'grouped', 'ajena', 'Ajena', 'ajena', 1, ${q(INTERNAL)});
    `);
    const afterForeign = db.json(`select public.read_canonical_category_decisions(${q(STUDY)}, ${q(TENANT)});`);
    check(
      !JSON.stringify(afterForeign).includes("Ajena"),
      "una decisión de otro inquilino no se recuerda por ningún camino",
    );
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[7] Nada fuera de su propia tabla se movió");
  {
    const after = inventory();
    const moved = Object.keys(after).filter(
      (table) => table !== "canonical_category_decision" && table !== "study" && after[table] !== before[table],
    );
    check(moved.length === 0, `ninguna otra tabla cambió de tamaño${moved.length ? `: ${moved.join(", ")}` : ""}`);
    check(
      Number(after.segment_dimension ?? 0) === Number(before.segment_dimension ?? 0),
      "en particular `segment_dimension` — el camino heredado — no recibió una sola fila",
    );
    check(
      Number(after.survey_response ?? 0) === Number(before.survey_response ?? 0),
      "y la evidencia canónica sigue intacta",
    );
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[8] La proyección cambia CATEGORÍAS y nunca RESPUESTAS");
  const { loadCanonicalRowSet } = await import("../src/lib/canonical-source/read.ts");
  const { canonicalResultSourceFromRows } = await import("../src/lib/canonical-source/assemble.ts");
  const { buildQualitativeGroups } = await import("../src/lib/results/qualitative.ts");
  const { CANONICAL_RESULTS_SPECS } = await import("../src/lib/results/spec.ts");

  const pagedTransport = {
    readPage: async (request) => {
      const where = [`tenant_id = ${q(request.scope.tenantId)}`, `study_id = ${q(request.scope.studyId)}`];
      for (const [column, value] of Object.entries(request.equals ?? {})) where.push(`${column} = ${q(value)}`);
      if (request.cursor !== null) {
        const keys = request.keyColumns;
        if (keys.length === 1) where.push(`${keys[0]} > ${q(request.cursor[keys[0]])}`);
        else {
          where.push(
            `(${keys[0]} > ${q(request.cursor[keys[0]])} or (${keys[0]} = ${q(request.cursor[keys[0]])} and ${keys[1]} > ${q(request.cursor[keys[1]])}))`,
          );
        }
      }
      const columns = request.columns
        .map((column) => (column === "manifest->plan" ? "manifest -> 'plan' as plan" : column))
        .join(", ");
      const rows = db.json(`
        select coalesce(jsonb_agg(t order by ${request.keyColumns.join(", ")}), '[]'::jsonb)
          from (select ${columns} from public.${request.table}
                 where ${where.join(" and ")}
                 order by ${request.keyColumns.join(", ")}
                 limit ${Number(request.limit)}) t;
      `);
      return { rows, error: null };
    },
  };

  const rows = await loadCanonicalRowSet(pagedTransport, { tenantId: TENANT, studyId: STUDY });
  const spec = CANONICAL_RESULTS_SPECS[rows.specId];
  check(spec !== undefined, `la especificación del paquete sintético está registrada (${rows.specId})`);
  const source = canonicalResultSourceFromRows(rows, { spec, tenantId: TENANT, studyId: STUDY });
  const scope = { participantIds: new Set(source.participants.map((p) => p.participantId)), filtered: false };

  const plain = buildQualitativeGroups(source, spec, scope);
  const family = plain.find((group) => group.terms.length >= 2);
  check(family !== undefined, `alguna familia cualitativa tiene al menos dos categorías (${plain.map((g) => g.terms.length).join("/")})`);

  if (family) {
    const [one, two] = family.terms;
    const folds = sortedFolds([one.label, two.label]);
    const merged = resolutionFrom([
      {
        decisionId: "x",
        familyKey: family.key,
        memberFolds: folds,
        memberLabels: [one.label, two.label],
        sourceDigest: DIGEST_A,
        disposition: "grouped",
        canonicalKey: "unida",
        canonicalLabel: "Categoría unida",
        rationale: null,
        version: 1,
        decidedAt: "2026-09-15T00:00:00Z",
      },
    ]);
    const after = buildQualitativeGroups(source, spec, scope, undefined, merged).find((g) => g.key === family.key);
    eq("hay una categoría menos", after.terms.length, family.terms.length - 1);
    eq("la unida suma las dos", after.terms.find((t) => t.label === "Categoría unida")?.count, one.count + two.count);
    eq("el total de respuestas NO cambia", after.total, family.total);
    eq("la base tampoco", JSON.stringify(after.base), JSON.stringify(family.base));
    eq("ni el conteo de las exclusiones", JSON.stringify(after.excluded), JSON.stringify(family.excluded));

    /* ---------------------------------------------------------------------- */
    console.log("\n[9] Y por eso la firma cualitativa caduca sola");
    // THE REAL SHAPE the publication boundary digests: the group's own label,
    // its coding, its ordered categories and its documented exclusions. The
    // blocks are outside the digest by design — moving a card does not un-review
    // a word — so what they say here cannot make this section pass.
    const bindingOf = (groups) =>
      groups.map((group) => ({
        groupLabel: group.label,
        coding: group.coding,
        categories: group.terms.map((term) => term.label),
        excluded: group.excluded.map((entry) => entry.label),
        blocks: ["Página · Bloque"],
      }));
    const digestBefore = qualitativeEvidenceDigest(bindingOf(plain));
    const digestAfter = qualitativeEvidenceDigest(
      bindingOf(buildQualitativeGroups(source, spec, scope, undefined, merged)),
    );
    check(digestBefore !== digestAfter, "la huella del conjunto de palabras se mueve con la decisión");
    const signOff = { id: "s", evidenceDigest: digestBefore, reviewedAt: "2026-09-15T00:00:00Z" };
    eq("antes de decidir la revisión está al día", qualitativeReviewState(bindingOf(plain), signOff), "current");
    eq(
      "después de decidir queda caduca, sin que nadie la invalide",
      qualitativeReviewState(bindingOf(buildQualitativeGroups(source, spec, scope, undefined, merged)), signOff),
      "stale",
    );

    /* ---------------------------------------------------------------------- */
    console.log("\n[10] Y ninguna palabra privada del origen entra a lo que se lee");
    const payload = JSON.stringify(
      buildQualitativeGroups(source, spec, scope, undefined, merged).concat(plain),
    );
    for (const sentinel of ["ZNOMBREPRIV", "ZIDPRIV", "ZTEXTOPRIV"]) {
      check(!payload.includes(sentinel), `ningún ${sentinel} viaja en los grupos cualitativos`);
    }
    check(payload.includes("ZCATEGPRIV"), "y las etiquetas de categoría —que sí son el dato— sí");

    const ledgerPayload = JSON.stringify(db.json(`select public.read_canonical_category_decisions(${q(STUDY)}, ${q(TENANT)});`));
    for (const sentinel of ["ZNOMBREPRIV", "ZIDPRIV", "ZTEXTOPRIV"]) {
      check(!ledgerPayload.includes(sentinel), `ni ${sentinel} en lo que devuelve el historial`);
    }

    // AND THE FAMILY DIGEST IS A FACT ABOUT WORDS, not about counts.
    const words = {
      key: family.key,
      coding: family.coding,
      sourceLabels: family.terms.map((t) => t.label),
      excludedLabels: family.excluded.map((e) => e.label),
    };
    eq(
      "la huella de la familia no depende de los conteos",
      categorySourceDigest(words),
      categorySourceDigest({ ...words, sourceLabels: [...words.sourceLabels].reverse() }),
    );
    check(
      categorySourceDigest(words) !== categorySourceDigest({ ...words, sourceLabels: [...words.sourceLabels, "Nueva"] }),
      "y sí de las palabras",
    );
    eq(
      "el pliegue que identifica un grupo es el mismo que usa la base",
      foldCategoryLabel(one.label),
      String(db.json(`select to_jsonb(lower(btrim(regexp_replace(${q(one.label)}, '\\s+', ' ', 'g'))));`)),
    );
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[11] Sobre HTTP real, un navegador no puede llamar a ninguna de las dos");
  const stack = await startLocalStack(db, {
    binary: POSTGREST,
    target,
    authUsers: [
      { id: INTERNAL, email: "interno@categorias.local", password: PASSWORD },
      { id: CLIENT_A, email: "cliente@categorias.local", password: PASSWORD },
    ],
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.apiOrigin;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceKey;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const service = createClient(stack.apiOrigin, stack.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient(stack.apiOrigin, stack.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const person = createClient(stack.apiOrigin, stack.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await person.auth.signInWithPassword({ email: "cliente@categorias.local", password: PASSWORD });

    const readArgs = { p_study_id: STUDY, p_tenant_id: TENANT };
    const asService = await service.rpc("read_canonical_category_decisions", readArgs);
    check(asService.error === null && asService.data !== null, "service_role la ejecuta y recibe el historial");

    const asAnon = await anon.rpc("read_canonical_category_decisions", readArgs);
    check(asAnon.error !== null, `anónimo leyendo: RECHAZADO (${asAnon.error?.code ?? "sin código"})`);
    const asPerson = await person.rpc("read_canonical_category_decisions", readArgs);
    check(asPerson.error !== null, `cliente autenticado leyendo: RECHAZADO (${asPerson.error?.code ?? "sin código"})`);

    const writeArgs = {
      p_study_id: STUDY,
      p_actor: INTERNAL,
      p_family_key: "activos",
      p_member_folds: ["ocho", "siete"],
      p_member_labels: ["Ocho", "Siete"],
      p_source_digest: DIGEST_A,
      p_disposition: "separate",
      p_canonical_label: null,
      p_canonical_fold: null,
      p_rationale: null,
      p_expected_version: 0,
    };
    const writeAnon = await anon.rpc("record_canonical_category_decision", writeArgs);
    check(writeAnon.error !== null, `anónimo escribiendo: RECHAZADO (${writeAnon.error?.code ?? "sin código"})`);
    const writePerson = await person.rpc("record_canonical_category_decision", writeArgs);
    check(writePerson.error !== null, `cliente autenticado escribiendo: RECHAZADO (${writePerson.error?.code ?? "sin código"})`);

    const writeService = await service.rpc("record_canonical_category_decision", writeArgs);
    check(writeService.error === null, `service_role escribiendo: ACEPTADO (${writeService.error?.message ?? "sin error"})`);

    // AND THE TABLE ITSELF IS UNREACHABLE FROM A BROWSER, not merely the function.
    const directAnon = await anon.from("canonical_category_decision").select("id").limit(1);
    check(directAnon.error !== null || (directAnon.data ?? []).length === 0, "anónimo leyendo la tabla directamente: nada");
    const directPerson = await person.from("canonical_category_decision").select("id").limit(1);
    check(directPerson.error !== null || (directPerson.data ?? []).length === 0, "cliente autenticado leyendo la tabla: nada");
    const insertPerson = await person
      .from("canonical_category_decision")
      .insert({ study_id: STUDY, tenant_id: TENANT, family_key: "x", member_folds: ["a", "b"], member_labels: ["A", "B"], source_digest: DIGEST_A, disposition: "separate", version: 1, decided_by: CLIENT_A });
    check(insertPerson.error !== null, `y escribiendo en ella directamente: RECHAZADO (${insertPerson.error?.code ?? "sin código"})`);
  } finally {
    await stack.stop();
  }
});

console.log("\n" + "=".repeat(86));
console.log(`RESUMEN: ${executed} comprobaciones, ${executed - failures} aprobadas, ${failures} falladas, ${skipped} omitidas.`);
if (failures > 0) {
  console.error("RESULTADO: el historial canónico de categorías NO se sostiene. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: sólo una persona interna decide, la base hace cumplir las tres reglas de una " +
    "agrupación plana, una réplica no es una segunda decisión, una pantalla vencida es " +
    "rechazada, el registro es inmutable, nada fuera de su propia tabla se mueve, agrupar " +
    "cambia cuántas categorías hay y nunca cuántas respuestas, la firma cualitativa caduca " +
    "sola, y un navegador no puede llamar ni leer ni escribir nada de esto. COMPUERTA APROBADA.",
);
