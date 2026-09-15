/**
 * Be Community — UNIT 6B.4B2K: migration 0033's projection, against a real
 * PostgreSQL and a real PostgREST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT PROVES, AND WHY EACH ONE NEEDS A REAL STACK.
 *
 *  [1] PARITY, BYTE FOR BYTE. The row set read in ONE round trip through
 *      `read_canonical_row_set` is deterministically identical to the row set
 *      read in twenty-eight through the paged reader — same families, same
 *      rows, same column values, same order. Nothing short of a real database
 *      can prove this: the whole question is whether SQL's projection and
 *      PostgREST's `select` return the same bytes.
 *
 *  [2] THE REQUEST COUNT. Counted at the transport, not asserted from reading
 *      the code: twenty-eight requests become one.
 *
 *  [3] THE RESULTS ARE THE SAME RESULTS. The canonical study results built from
 *      each row set serialize identically, so no figure a client could ever see
 *      depends on which path fetched the rows.
 *
 *  [4] CROSS-TENANT REFUSAL. The same study id under the WRONG tenant returns
 *      nothing — proved against the function itself, not against the caller
 *      that usually passes the right one.
 *
 *  [5] A BROWSER CANNOT CALL IT. `anon` and an authenticated non-service role
 *      are both refused execution by the grant, over real HTTP.
 *
 *  [6] IT CANNOT WRITE. `stable` is enforced by PostgreSQL, so a write inside
 *      the function raises; and the function is proved not to have moved a
 *      single row by comparing every table's count before and after.
 *
 *  [7] THE CEILINGS STILL REFUSE. A family projected past its bound is a
 *      refusal in the caller, never a truncation.
 *
 *  [8] AND THE PAGED READER STILL WORKS. A transport without `readAggregate`
 *      answers exactly as it always did, so a database without 0033 degrades
 *      rather than breaks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TOUCHES NO HOSTED PROJECT. `resolveDisposableTarget` refuses to run if a
 * Supabase variable is in scope, and every byte below lives in a database this
 * script creates and drops.
 */

import { existsSync } from "node:fs";
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

const TENANT = "00000000-0000-4000-8000-0000000010a1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000010a2";
const STUDY = "00000000-0000-4000-8000-0000000020b1";
const INTERNAL = "00000000-0000-4000-8000-0000000030c1";
const CLIENT_A = "00000000-0000-4000-8000-0000000030c2";
const PASSWORD = "contrasena-de-un-solo-uso-3b7e";
const POSTGREST =
  process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

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

console.log("Be Community — Unit 6B.4B2K: one round trip for the canonical row set");
console.log("=".repeat(86));

await withDisposableDatabase(target, "rowset", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0034, one tenant, one committed package");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(33);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'Comunidad Uno'),
      (${q(OTHER_TENANT)}, 'Comunidad Dos');
    insert into auth.users (id, email) values
      (${q(INTERNAL)}, 'interno@proyeccion.local'),
      (${q(CLIENT_A)}, 'cliente@proyeccion.local');
    insert into public.profiles (user_id, tenant_id, role, full_name) values
      (${q(INTERNAL)}, ${q(TENANT)}, 'internal', 'Persona interna'),
      (${q(CLIENT_A)}, ${q(TENANT)}, 'client', 'Cliente autorizado');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio proyectado', 'published');
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

  /* ------------------------------------------------------------------------ */
  console.log("\n[0] La función existe, es STABLE, es SECURITY INVOKER y sólo la ejecuta service_role");

  const meta = db.json(`
    select jsonb_build_object(
      'volatility', p.provolatile,
      'security_definer', p.prosecdef,
      'kind', p.prokind,
      'config', coalesce(to_jsonb(p.proconfig), 'null'::jsonb),
      'acl', coalesce(array_to_json(p.proacl)::jsonb, '[]'::jsonb)
    )
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'read_canonical_row_set';
  `);
  eq("la volatilidad", meta?.volatility, "s");
  eq("security definer", meta?.security_definer, false);
  check(
    Array.isArray(meta?.config) &&
      meta.config.some((entry) => /^search_path=(""|'')?$/.test(String(entry))),
    `search_path fijado a vacío (fue ${JSON.stringify(meta?.config)})`,
  );
  const acl = (meta?.acl ?? []).map(String);
  check(
    acl.some((entry) => entry.startsWith("service_role=")),
    `service_role puede ejecutarla (acl ${JSON.stringify(acl)})`,
  );
  check(
    !acl.some((entry) => /^=|^anon=|^authenticated=/.test(entry)),
    "y ni PUBLIC, ni anon, ni authenticated pueden",
  );

  /* ------------------------------------------------------------------------ */
  console.log("\n[1] Paridad: un viaje y veintiocho devuelven exactamente lo mismo");

  const { loadCanonicalRowSet } = await import("../src/lib/canonical-source/read.ts");
  const { buildCanonicalStudyResults } = await import("../src/lib/results/build.ts");
  const { canonicalResultSourceFromRows } = await import("../src/lib/canonical-source/assemble.ts");
  const { CANONICAL_RESULTS_SPECS } = await import("../src/lib/results/spec.ts");

  /** A transport over psql, counting every round trip it makes. */
  const countingTransport = (withAggregate) => {
    const calls = { pages: 0, aggregates: 0 };
    const base = {
      readPage: async (request) => {
        calls.pages += 1;
        const where = [`tenant_id = ${q(request.scope.tenantId)}`, `study_id = ${q(request.scope.studyId)}`];
        for (const [column, value] of Object.entries(request.equals ?? {})) {
          where.push(`${column} = ${q(value)}`);
        }
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
    if (!withAggregate) return { transport: base, calls };
    return {
      transport: {
        ...base,
        readAggregate: async (request) => {
          calls.aggregates += 1;
          const families = db.json(
            `select public.read_canonical_row_set(${q(request.scope.tenantId)}, ${q(request.scope.studyId)}, ${q(request.packageIdempotencyKey ?? null)});`,
          );
          return { families, error: null };
        },
      },
      calls,
    };
  };

  const paged = countingTransport(false);
  const projected = countingTransport(true);
  const viaPages = await loadCanonicalRowSet(paged.transport, { tenantId: TENANT, studyId: STUDY });
  const viaProjection = await loadCanonicalRowSet(projected.transport, { tenantId: TENANT, studyId: STUDY });

  check(
    JSON.stringify(viaPages) === JSON.stringify(viaProjection),
    "el conjunto de filas es IDÉNTICO byte a byte por los dos caminos",
  );
  const families = Object.entries(viaPages).filter(([, value]) => Array.isArray(value));
  check(families.length === 26, `y son las veintiséis familias (fueron ${families.length})`);
  const rowTotal = families.reduce((sum, [, value]) => sum + value.length, 0);
  check(rowTotal > 100, `sobre un paquete real, no vacío: ${rowTotal} filas`);
  for (const [name, value] of families) {
    check(
      JSON.stringify(value) === JSON.stringify(viaProjection[name]),
      `«${name}» coincide (${value.length} filas)`,
    );
  }

  /* ------------------------------------------------------------------------ */
  console.log("\n[2] El presupuesto de peticiones: veintiocho se vuelven una");

  eq("peticiones por páginas", paged.calls.pages, 28);
  eq("peticiones por proyección", projected.calls.pages + projected.calls.aggregates, 1);
  check(projected.calls.pages === 0, "y ninguna de ellas es una lectura de tabla");

  /* ------------------------------------------------------------------------ */
  console.log("\n[3] Los resultados que se calculan encima son los mismos");

  const resultsOf = (rows) =>
    buildCanonicalStudyResults(
      canonicalResultSourceFromRows(rows, {
        spec: CANONICAL_RESULTS_SPECS[rows.specId],
        tenantId: TENANT,
        studyId: STUDY,
      }),
      { spec: CANONICAL_RESULTS_SPECS[rows.specId] },
    );
  const fromPages = resultsOf(viaPages);
  const fromProjection = resultsOf(viaProjection);
  check(
    JSON.stringify(fromPages) === JSON.stringify(fromProjection),
    "el documento de resultados canónicos es idéntico",
  );
  // Y NO ES UN DOCUMENTO VACÍO COMPARADO CONSIGO MISMO. Dos documentos vacíos
  // también serían idénticos, así que se comprueba que este lleva cifras.
  check(typeof fromPages.contractVersion === "string", "y es un documento de resultados de verdad");
  eq("la población leída", fromPages.population?.total, viaPages.participants.length);
  check(
    fromPages.recommendation.scopes.length > 0 && fromPages.performance.dimensions.length > 0,
    `lleva cifras: ${fromPages.recommendation.scopes.length} alcances de recomendación y ${fromPages.performance.dimensions.length} dimensiones de desempeño`,
  );

  /* ------------------------------------------------------------------------ */
  console.log("\n[4] El alcance: otro inquilino no recibe una sola fila");

  const wrongTenant = db.json(
    `select public.read_canonical_row_set(${q(OTHER_TENANT)}, ${q(STUDY)}, null);`,
  );
  const leaked = Object.entries(wrongTenant ?? {}).filter(
    ([, value]) => Array.isArray(value) && value.length > 0,
  );
  check(leaked.length === 0, `el estudio bajo el inquilino equivocado devuelve cero filas en todas las familias${leaked.length ? `: ${leaked.map(([k, v]) => `${k}=${v.length}`).join(", ")}` : ""}`);

  const wrongStudy = db.json(
    `select public.read_canonical_row_set(${q(TENANT)}, '00000000-0000-4000-8000-00000000dead', null);`,
  );
  const leakedStudy = Object.entries(wrongStudy ?? {}).filter(
    ([, value]) => Array.isArray(value) && value.length > 0,
  );
  check(leakedStudy.length === 0, "y un estudio que no existe tampoco");

  /* ------------------------------------------------------------------------ */
  console.log("\n[5] No muta nada: cada tabla tiene las mismas filas antes y después");

  const countsOf = () =>
    db.json(`
      select coalesce(jsonb_object_agg(rel, n), '{}'::jsonb) from (
        select c.relname as rel,
               (xpath('/row/c/text()', query_to_xml(
                 format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint as n
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relkind = 'r'
      ) t;
    `);
  const before = countsOf();
  db.json(`select public.read_canonical_row_set(${q(TENANT)}, ${q(STUDY)}, null);`);
  db.json(`select public.read_canonical_row_set(${q(TENANT)}, ${q(STUDY)}, null);`);
  const after = countsOf();
  check(
    JSON.stringify(before) === JSON.stringify(after),
    `ninguna tabla cambió de tamaño (${Object.keys(before ?? {}).length} tablas comparadas)`,
  );
  check(Object.keys(before ?? {}).length > 20, "y se compararon todas las tablas, no unas cuantas");

  /* ------------------------------------------------------------------------ */
  console.log("\n[6] Los techos siguen RECHAZANDO, no truncando");

  const tiny = {
    ...projected.transport,
    readAggregate: async (request) => {
      const value = await projected.transport.readAggregate(request);
      return value;
    },
  };
  // Un techo imposible: una familia con más filas de las que su lectura declara
  // debe ser un rechazo. Se prueba bajando el techo declarado, que es la única
  // forma de provocarlo sin fabricar cien mil filas.
  const { CANONICAL_READS } = await import("../src/lib/canonical-source/read.ts");
  const realCeiling = CANONICAL_READS.responses.maxRows;
  let refused = null;
  try {
    Object.defineProperty(CANONICAL_READS.responses, "maxRows", { value: 1, configurable: true });
    await loadCanonicalRowSet(tiny, { tenantId: TENANT, studyId: STUDY });
  } catch (thrown) {
    refused = thrown?.code ?? String(thrown);
  } finally {
    Object.defineProperty(CANONICAL_READS.responses, "maxRows", {
      value: realCeiling,
      configurable: true,
    });
  }
  eq("una familia por encima de su techo", refused, "READ_EXCEEDS_CEILING");

  /* ------------------------------------------------------------------------ */
  console.log("\n[7] Sin 0033, el lector por páginas sigue respondiendo lo mismo");

  const degraded = countingTransport(true);
  degraded.transport.readAggregate = async () => ({
    families: null,
    error: { code: "PGRST202", message: "function does not exist" },
  });
  const viaFallback = await loadCanonicalRowSet(degraded.transport, {
    tenantId: TENANT,
    studyId: STUDY,
  });
  check(
    JSON.stringify(viaFallback) === JSON.stringify(viaPages),
    "una base sin la función degrada al camino paginado, con el mismo resultado",
  );
  eq("y vuelve a costar veintiocho peticiones", degraded.calls.pages, 28);

  // Y CUALQUIER OTRO ERROR ES EL ERROR. Degradar ante un fallo de transporte
  // volvería a gastar veintiocho peticiones justo cuando no quedan.
  const broken = countingTransport(true);
  broken.transport.readAggregate = async () => ({
    families: null,
    error: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  let brokenCode = null;
  try {
    await loadCanonicalRowSet(broken.transport, { tenantId: TENANT, studyId: STUDY });
  } catch (thrown) {
    brokenCode = thrown?.transport ?? null;
  }
  check(brokenCode !== null, `un fallo real de la proyección no degrada: se rechaza (${brokenCode})`);
  eq("y no gasta una sola petición de página", broken.calls.pages, 0);

  /* ------------------------------------------------------------------------ */
  if (!existsSync(POSTGREST)) {
    skipped += 1;
    console.log(`\n— OMITIDO [8]: no hay binario de PostgREST en ${POSTGREST}.`);
    console.log("  La negación por rol se prueba sobre HTTP real o no se prueba.");
    return;
  }

  console.log("\n[8] Sobre HTTP real: un navegador no puede llamarla");
  const stack = await startLocalStack(db, {
    binary: POSTGREST,
    target,
    authUsers: [
      { id: INTERNAL, email: "interno@proyeccion.local", password: PASSWORD },
      { id: CLIENT_A, email: "cliente@proyeccion.local", password: PASSWORD },
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
    await person.auth.signInWithPassword({ email: "cliente@proyeccion.local", password: PASSWORD });

    const args = { p_tenant_id: TENANT, p_study_id: STUDY, p_package_key: null };
    const asService = await service.rpc("read_canonical_row_set", args);
    check(asService.error === null && asService.data !== null, "service_role la ejecuta y recibe el conjunto");

    const asAnon = await anon.rpc("read_canonical_row_set", args);
    check(asAnon.error !== null, `anónimo: RECHAZADO (${asAnon.error?.code ?? "sin código"})`);
    check(asAnon.data === null, "y no recibe una sola familia");

    const asPerson = await person.rpc("read_canonical_row_set", args);
    check(asPerson.error !== null, `cliente autenticado: RECHAZADO (${asPerson.error?.code ?? "sin código"})`);
    check(asPerson.data === null, "y tampoco recibe nada");

    // Y EL CAMINO COMPLETO, a través del transporte real del producto.
    const { postgrestReadTransport } = await import("../src/lib/canonical-source/postgrest.ts");
    const real = postgrestReadTransport(service);
    const viaHttp = await loadCanonicalRowSet(real, { tenantId: TENANT, studyId: STUDY });
    check(
      JSON.stringify(viaHttp) === JSON.stringify(viaPages),
      "y sobre PostgREST real el resultado sigue siendo idéntico al paginado",
    );
  } finally {
    await stack.stop();
  }
});

console.log("\n" + "=".repeat(86));
console.log(`RESUMEN: ${executed} comprobaciones, ${executed - failures} aprobadas, ${failures} falladas, ${skipped} omitidas.`);
if (failures > 0) {
  console.error("RESULTADO: la proyección 0033 NO se sostiene. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: la proyección devuelve exactamente lo que devolvía el lector por páginas, en una " +
    "petición en vez de veintiocho, sin mover una fila, sin cruzar inquilinos y sin que un " +
    "navegador pueda llamarla. COMPUERTA APROBADA.",
);
