// =============================================================================
// THE IMPORT REHEARSAL — the real operator, the real package, a disposable
// database and a real PostgREST.
// =============================================================================
//   BECOMMUNITY_POSTGREST_BIN=$HOME/becommunity-postgrest/postgrest \
//   CANONICAL_COMMIT_TEST_PGHOST=$HOME/becommunity-pg/socket \
//   CANONICAL_COMMIT_TEST_PGUSER=$(id -un) \
//   CANONICAL_IMPORT_CLEAN_XLSX=<path> CANONICAL_IMPORT_PAIN_XLSX=<path> \
//     npm run test:canonical-import-rehearsal
// =============================================================================
// This is the ONE place the whole chain runs end to end before anything hosted
// is touched: the real workbooks, the real preflight, the real projector, the
// real `stage_canonical_package` and `commit_canonical_package`, the real
// ownership ledger, the real `rollback_canonical_package`, and then the new
// database-backed read adapter reading the committed package back out and
// reproducing the approved dashboard's numbers from it.
//
// EVERYTHING IT TOUCHES IS DISPOSABLE. `scripts/lib/disposable-postgres.mjs`
// refuses a remote host, a password, a Supabase host or a service-role key in
// scope, so this cannot be pointed at a real project even by accident. The
// database is created for the run, named `becommunity_canonical_test_*`, and
// dropped on success and on failure alike.
//
// A GREEN RUN HERE IS NOT A HOSTED RUN. It proves the operator, the adapter,
// the refusals and the round trip. It does not prove the hosted API gateway's
// body limit, the hosted statement timeout, or Supabase's own catalogue. Those
// stay hosted-only, and are reported separately.
//
// IT IS DELIBERATELY OUTSIDE `npm test`: it needs the two real workbooks, a
// PostgreSQL server and a PostgREST binary, and an unexecuted gate must never
// be counted among the offline results.
// =============================================================================

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { acknowledgementFor } from "./lib/canonical-import-target.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const BINARY =
  process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

const cleanPath = process.argv[2] ?? process.env.CANONICAL_IMPORT_CLEAN_XLSX;
const painPath = process.argv[3] ?? process.env.CANONICAL_IMPORT_PAIN_XLSX;

console.log("Be Community — ensayo completo de importación canónica (pila local desechable)");
console.log("=".repeat(78));

if (!cleanPath || !painPath) {
  console.log(
    "\nOMITIDO: este ensayo necesita los dos libros reales.\n" +
      "  CANONICAL_IMPORT_CLEAN_XLSX / CANONICAL_IMPORT_PAIN_XLSX, o dos argumentos.\n" +
      "Un ensayo no ejecutado NO es un ensayo aprobado; se reporta como omitido.",
  );
  console.log("\nRESUMEN: 0 comprobaciones ejecutadas (ENSAYO OMITIDO)");
  process.exit(0);
}

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

let passed = 0;
let failed = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    passed += 1;
    console.log("  ✓", label);
  } else {
    failed += 1;
    console.error("  ✗ FAIL:", label, detail ? `— ${detail}` : "");
  }
};

const evidenceDirectory = mkdtempSync(join(tmpdir(), "becommunity-import-rehearsal-"));

/**
 * Run one of the two command-line tools as a child process.
 *
 * The tools are executed EXACTLY as an operator would execute them, including
 * their own authorization guard, so a rehearsal cannot bypass a refusal that a
 * real run would hit.
 *
 * IT MUST BE ASYNCHRONOUS, and that is not a style preference. The PostgREST
 * path shim is an HTTP server running INSIDE THIS PROCESS, so a synchronous
 * spawn blocks the event loop that serves it: the child opens a connection the
 * parent can never accept, and the two wait for each other until something
 * kills them. A synchronous spawn here is a deadlock, not a slow path.
 */
function runTool(script, env, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX, join(ROOT, "scripts", script), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

let exitCode = 1;

await withDisposableDatabase(target, "import", async (db) => {
  console.log("\n[0] Preparando la base desechable");
  const psql = psqlSuiteTransport(db);
  psql.prepare();
  const scope = await psql.createStudy("import-rehearsal");
  const otherScope = await psql.createStudy("import-rehearsal-other");
  console.log(`  estudio destino  = ${scope.studyId}`);
  console.log(`  estudio ajeno    = ${otherScope.studyId}`);

  const stack = await startLocalStack(db, { binary: BINARY, target });
  console.log(`  api = ${stack.apiOrigin}   postgrest = ${(await stack.serverHeader()) ?? "sin banner"}`);

  // The fingerprint is not hardcoded here: it is read from the operator's own
  // dry run, and then every later run must reproduce it exactly. Hardcoding it
  // would make this file a second place the expected plan is declared.
  const baseEnv = {
    CANONICAL_IMPORT_PROJECT_REF: "local",
    CANONICAL_IMPORT_ACKNOWLEDGE: acknowledgementFor("local"),
    CANONICAL_IMPORT_SERVICE_KEY: stack.serviceKey,
    CANONICAL_IMPORT_API_URL: stack.apiOrigin,
    CANONICAL_IMPORT_TENANT_ID: scope.tenant,
    CANONICAL_IMPORT_STUDY_ID: scope.studyId,
    CANONICAL_IMPORT_MAPPING_VERSION: "1",
    CANONICAL_IMPORT_CLEAN_XLSX: cleanPath,
    CANONICAL_IMPORT_PAIN_XLSX: painPath,
    CANONICAL_IMPORT_EVIDENCE_DIR: evidenceDirectory,
    // The disposable guard's own variable must NOT be inherited into a real
    // import; the operator refuses if it is. Cleared explicitly here so the
    // rehearsal proves the operator rather than the shell.
    CANONICAL_HOSTED_DISPOSABLE_PREFIX: "",
  };

  try {
    // -----------------------------------------------------------------------
    console.log("\n[1] Ensayo (sin --execute): descubre la huella y no escribe nada");
    const discover = await runTool("canonical-import-operator.mjs", {
      ...baseEnv,
      CANONICAL_IMPORT_PLAN_FINGERPRINT: `sha256:${"0".repeat(64)}`,
    });
    const fingerprint = /huella del plan = (sha256:[0-9a-f]{64})/.exec(discover.out)?.[1] ?? null;
    check("el ensayo imprime la huella del plan que produjo", fingerprint !== null);
    check(
      "y RECHAZA porque la huella no es la autorizada",
      discover.code === 1 && /la huella del plan es EXACTAMENTE la autorizada/.test(discover.out),
      `code=${discover.code}`,
    );
    console.log(`  huella descubierta = ${fingerprint}`);
    const env = { ...baseEnv, CANONICAL_IMPORT_PLAN_FINGERPRINT: fingerprint };

    const emptyBefore = Number(
      db.run("select count(*) from public.study_participant;").trim(),
    );
    check("las tablas canónicas empiezan vacías", emptyBefore === 0, `study_participant=${emptyBefore}`);

    const dry = await runTool("canonical-import-operator.mjs", env);
    check("con la huella correcta el ensayo termina en verde", dry.code === 0, `code=${dry.code}`);
    check("y dice explícitamente que no escribió nada", /MODO ENSAYO/.test(dry.out));
    const afterDry = Number(db.run("select count(*) from public.study_participant;").trim());
    check("y no escribió nada", afterDry === 0, `study_participant=${afterDry}`);

    // -----------------------------------------------------------------------
    console.log("\n[2] Las negativas: cada una es un rechazo con nombre");
    const refusals = [
      ["sin --project", { ...env }, ["--execute"], /--execute needs --project/],
      ["con un --project distinto", { ...env }, ["--execute", "--project", "otro"], /--project does not name/],
      [
        "con un reconocimiento que no nombra el proyecto",
        { ...env, CANONICAL_IMPORT_ACKNOWLEDGE: "I-AUTHORIZE-CANONICAL-IMPORT-INTO-otro" },
        ["--execute", "--project", "local"],
        /does not name the target/,
      ],
      [
        "sin reconocimiento",
        { ...env, CANONICAL_IMPORT_ACKNOWLEDGE: "" },
        ["--execute", "--project", "local"],
        /is not set/,
      ],
      [
        "con el prefijo desechable en el entorno",
        { ...env, CANONICAL_HOSTED_DISPOSABLE_PREFIX: "U4-ABC123" },
        ["--execute", "--project", "local"],
        /belongs to the disposable acceptance run/,
      ],
      [
        "con un cliente que no es uuid",
        { ...env, CANONICAL_IMPORT_TENANT_ID: "cd4d6acd" },
        ["--execute", "--project", "local"],
        /not a full uuid/,
      ],
      [
        "sin directorio de evidencia",
        { ...env, CANONICAL_IMPORT_EVIDENCE_DIR: "" },
        ["--execute", "--project", "local"],
        /is not set/,
      ],
      [
        "con evidencia dentro del repositorio",
        { ...env, CANONICAL_IMPORT_EVIDENCE_DIR: join(ROOT, "evidence") },
        ["--execute", "--project", "local"],
        /inside the worktree/,
      ],
      [
        "con una versión de mapeo distinta",
        { ...env, CANONICAL_IMPORT_MAPPING_VERSION: "2" },
        [],
        /la versión de mapeo es exactamente la autorizada/,
      ],
    ];
    for (const [label, refusalEnv, args, pattern] of refusals) {
      const answer = await runTool("canonical-import-operator.mjs", refusalEnv, args);
      check(`rechaza ${label}`, answer.code !== 0 && pattern.test(answer.out), `code=${answer.code}`);
    }
    {
      const answer = await runTool("canonical-import-operator.mjs", { ...env, CANONICAL_IMPORT_STUDY_ID: otherScope.studyId });
      check(
        "rechaza un estudio que no es el autorizado (el plan declara otro)",
        answer.code !== 0,
        `code=${answer.code}`,
      );
    }
    {
      // A package missing one of its two workbooks cannot be preflighted.
      const answer = await runTool("canonical-import-operator.mjs", { ...env, CANONICAL_IMPORT_PAIN_XLSX: cleanPath });
      check("rechaza un paquete incompleto", answer.code !== 0, `code=${answer.code}`);
    }
    const afterRefusals = Number(db.run("select count(*) from public.study_participant;").trim());
    check("ninguna negativa escribió una fila", afterRefusals === 0, `study_participant=${afterRefusals}`);

    // -----------------------------------------------------------------------
    console.log("\n[3] La importación real, por la vía del producto");
    const first = await runTool("canonical-import-operator.mjs", env, ["--execute", "--project", "local"]);
    const importJobId = /trabajo de importación = ([0-9a-f-]{36})/.exec(first.out)?.[1] ?? null;
    if (first.code !== 0) console.log(first.out.split("\n").slice(-40).join("\n"));
    check("la importación se completó", first.code === 0, `code=${first.code}`);
    check("y produjo un identificador de trabajo", importJobId !== null);
    check("y concilió las 32 familias", /las 32 familias concilian/.test(first.out));
    check("y dejó el trabajo en 'committed'", /el trabajo quedó en 'committed'/.test(first.out));
    check("y no fue una repetición", /repetición idempotente = false/.test(first.out));
    check("y no movió ninguna fila heredada", /respondent no cambió/.test(first.out));
    check("y no filtró ningún valor privado", /ninguno de los \d+ valores de origen del plan aparece/.test(first.out));

    const counts = JSON.parse(
      db.run(
        `select json_build_object(
           'participants', (select count(*) from public.study_participant where study_id = '${scope.studyId}'),
           'responses', (select count(*) from public.survey_response where study_id = '${scope.studyId}'),
           'lineage', (select count(*) from public.source_lineage where study_id = '${scope.studyId}'),
           'ledger', (select count(*) from public.import_job_record where study_id = '${scope.studyId}'),
           'persons', (select count(*) from public.person_private where tenant_id = '${scope.tenant}')
         )::text;`,
      ).trim(),
    );
    console.log(`  medido por la base: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    check("60 identidades", Number(counts.persons) === 60, String(counts.persons));
    check("60 participaciones", Number(counts.participants) === 60, String(counts.participants));
    check("1 685 respuestas", Number(counts.responses) === 1685, String(counts.responses));
    check("5 029 filas de linaje", Number(counts.lineage) === 5029, String(counts.lineage));

    // -----------------------------------------------------------------------
    console.log("\n[4] Paridad desde la base de datos");
    const parity = await runTool("canonical-database-parity.mjs", env);
    // Every failing line, not the tail: a gate that fails in its first section
    // and passes everywhere else would otherwise print forty green lines and
    // hide the one that mattered.
    if (parity.code !== 0) {
      for (const line of parity.out.split("\n")) if (/✗|FALLO|REFUSED/.test(line)) console.log(`    ${line.trim()}`);
    }
    check("la paridad desde la base de datos aprueba", parity.code === 0, `code=${parity.code}`);
    check(
      "las 32 familias del modelo de lectura son idénticas a las de memoria",
      /familias del modelo de lectura son idénticas/.test(parity.out),
    );
    check("los dos documentos son idénticos byte a byte", /idénticos byte a byte/.test(parity.out));
    check(
      "531 comparaciones ejecutadas y aprobadas desde la base de datos",
      /ejecutadas=531 aprobadas=531 falladas=0 omitidas=0/.test(parity.out),
    );
    check("la lectura devolvió sólo agregados", !/display_name|normalized_name/.test(parity.out));

    // -----------------------------------------------------------------------
    console.log("\n[5] Repetición idempotente del mismo paquete");
    const replay = await runTool("canonical-import-operator.mjs", env, [
      "--execute",
      "--project",
      "local",
      "--expect-replay",
    ]);
    if (replay.code !== 0) console.log(replay.out.split("\n").slice(-30).join("\n"));
    check("la repetición se completó", replay.code === 0, `code=${replay.code}`);
    check("y se reconoció como repetición", /repetición idempotente = true/.test(replay.out));
    const replayJobId = /trabajo de importación = ([0-9a-f-]{36})/.exec(replay.out)?.[1] ?? null;
    check("y reutilizó el MISMO trabajo de importación", replayJobId === importJobId);
    const countsAfterReplay = JSON.parse(
      db.run(
        `select json_build_object(
           'participants', (select count(*) from public.study_participant where study_id = '${scope.studyId}'),
           'responses', (select count(*) from public.survey_response where study_id = '${scope.studyId}'),
           'lineage', (select count(*) from public.source_lineage where study_id = '${scope.studyId}'),
           'ledger', (select count(*) from public.import_job_record where study_id = '${scope.studyId}'),
           'persons', (select count(*) from public.person_private where tenant_id = '${scope.tenant}')
         )::text;`,
      ).trim(),
    );
    check(
      "la repetición no duplicó ninguna fila canónica",
      JSON.stringify(counts) === JSON.stringify(countsAfterReplay),
      JSON.stringify(countsAfterReplay),
    );

    // -----------------------------------------------------------------------
    console.log("\n[6] Un paquete ajeno ya confirmado detiene una importación nueva");
    {
      const foreign = await runTool("canonical-import-operator.mjs", {
        ...env,
        CANONICAL_IMPORT_STUDY_ID: scope.studyId,
        CANONICAL_IMPORT_PACKAGE_KEY: `sha256:${"f".repeat(64)}`,
      });
      check(
        "una clave de paquete distinta a la del preflight es un rechazo",
        foreign.code !== 0 && /la clave del paquete es exactamente la esperada/.test(foreign.out),
        `code=${foreign.code}`,
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n[7] Reversión por la vía del producto, y sin residuo");
    const rollback = await runTool("canonical-import-operator.mjs", env, [
      "--execute",
      "--project",
      "local",
      "--rollback-import-job",
      importJobId,
    ]);
    if (rollback.code !== 0) console.log(rollback.out.split("\n").slice(-30).join("\n"));
    check("la reversión se completó", rollback.code === 0, `code=${rollback.code}`);
    check("y no quedó residuo canónico", /no queda ningún residuo canónico/.test(rollback.out));

    const afterRollback = JSON.parse(
      db.run(
        `select json_build_object(
           'participants', (select count(*) from public.study_participant where study_id = '${scope.studyId}'),
           'responses', (select count(*) from public.survey_response where study_id = '${scope.studyId}'),
           'lineage', (select count(*) from public.source_lineage where study_id = '${scope.studyId}'),
           'ledger', (select count(*) from public.import_job_record where study_id = '${scope.studyId}'),
           'persons', (select count(*) from public.person_private where tenant_id = '${scope.tenant}'),
           'assets', (select count(*) from public.source_asset where study_id = '${scope.studyId}'),
           'jobs', (select count(*) from public.import_job where study_id = '${scope.studyId}')
         )::text;`,
      ).trim(),
    );
    console.log(`  tras revertir: ${Object.entries(afterRollback).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    check("no queda ninguna participación", Number(afterRollback.participants) === 0);
    check("no queda ninguna respuesta", Number(afterRollback.responses) === 0);
    check("no queda ninguna fila de linaje", Number(afterRollback.lineage) === 0);
    check("no queda ninguna fila en el registro de propiedad", Number(afterRollback.ledger) === 0);
    check("no queda ninguna identidad", Number(afterRollback.persons) === 0);
    check("la procedencia SOBREVIVE: el trabajo sigue registrado", Number(afterRollback.jobs) === 1);
    check("y los archivos de origen también", Number(afterRollback.assets) === 2);

    const secondRollback = await runTool("canonical-import-operator.mjs", env, [
      "--execute",
      "--project",
      "local",
      "--rollback-import-job",
      importJobId,
    ]);
    check("revertir dos veces responde igual, no rechaza", secondRollback.code === 0, `code=${secondRollback.code}`);
    check("y la segunda se reconoce como repetición", /repetida = true/.test(secondRollback.out));

    // -----------------------------------------------------------------------
    console.log("\n[8] Después de revertir, la lectura no inventa un paquete");
    const parityAfter = await runTool("canonical-database-parity.mjs", env);
    check(
      "la paridad se niega a leer un estudio sin paquete confirmado",
      parityAfter.code !== 0 && /NO_COMMITTED_PACKAGE/.test(parityAfter.out),
      `code=${parityAfter.code}`,
    );

    // -----------------------------------------------------------------------
    console.log("\n[9] Se puede volver a importar desde cero tras una reversión");
    const again = await runTool("canonical-import-operator.mjs", env, ["--execute", "--project", "local"]);
    check("la reimportación se completó", again.code === 0, `code=${again.code}`);
    check("y volvió a conciliar", /las 32 familias concilian/.test(again.out));
    const againJobId = /trabajo de importación = ([0-9a-f-]{36})/.exec(again.out)?.[1] ?? null;
    check("reutilizando el mismo trabajo idempotente", againJobId === importJobId);
    const parityAgain = await runTool("canonical-database-parity.mjs", env);
    check("y la paridad desde la base vuelve a aprobar", parityAgain.code === 0, `code=${parityAgain.code}`);

    // -----------------------------------------------------------------------
    console.log("\n[10] El alcance por cliente y por estudio se respeta de verdad");
    {
      const wrongStudy = await runTool("canonical-database-parity.mjs", {
        ...env,
        CANONICAL_IMPORT_STUDY_ID: otherScope.studyId,
      });
      check(
        "leer el estudio ajeno no devuelve el paquete de éste",
        wrongStudy.code !== 0 && /NO_COMMITTED_PACKAGE/.test(wrongStudy.out),
        `code=${wrongStudy.code}`,
      );
      const wrongTenant = await runTool("canonical-database-parity.mjs", {
        ...env,
        CANONICAL_IMPORT_TENANT_ID: otherScope.tenant,
      });
      check(
        "leer con el cliente equivocado tampoco lo devuelve",
        wrongTenant.code !== 0 && /NO_COMMITTED_PACKAGE/.test(wrongTenant.out),
        `code=${wrongTenant.code}`,
      );
      const otherCounts = Number(
        db.run(`select count(*) from public.study_participant where study_id = '${otherScope.studyId}';`).trim(),
      );
      check("y el estudio ajeno sigue vacío", otherCounts === 0, String(otherCounts));
    }

    // -----------------------------------------------------------------------
    console.log("\n[11] Una conciliación forzada a fallar se revierte, no se parchea");
    {
      // One canonical row is deleted BEHIND the operator's back, so the next
      // independent count cannot agree with the plan. The operator must answer
      // with the product's rollback and leave nothing behind — which is exactly
      // what a real count disagreement would mean.
      db.run(
        `set role service_role;
         delete from public.survey_response
          where study_id = '${scope.studyId}'
            and id = (select id from public.survey_response where study_id = '${scope.studyId}' order by id limit 1);`,
      );
      const damaged = await runTool("canonical-import-operator.mjs", env, ["--execute", "--project", "local"]);
      check("la conciliación detecta la fila que falta", /DIFIERE/.test(damaged.out));
      check("y el operador termina en rojo", damaged.code !== 0, `code=${damaged.code}`);
      check("y revierte por la RPC del producto", /rollback_canonical_package: rolled_back|reversión/.test(damaged.out));
      const residue = Number(
        db.run(`select count(*) from public.import_job_record where study_id = '${scope.studyId}';`).trim(),
      );
      check("y el registro de propiedad queda vacío", residue === 0, String(residue));
      const stillThere = Number(
        db.run(`select count(*) from public.survey_response where study_id = '${scope.studyId}';`).trim(),
      );
      check("y no queda ninguna respuesta a medias", stillThere === 0, String(stillThere));
    }

    // -----------------------------------------------------------------------
    console.log("\n[12] La evidencia quedó fuera del repositorio y sin secretos");
    {
      const { readdirSync } = await import("node:fs");
      const artifacts = readdirSync(evidenceDirectory).filter((name) => name.endsWith(".json"));
      check("se escribió al menos un archivo de evidencia", artifacts.length >= 1, String(artifacts.length));
      const text = artifacts.map((name) => readFileSync(join(evidenceDirectory, name), "utf8")).join("\n");
      check("la evidencia no contiene la clave de servicio", !text.includes(stack.serviceKey));
      check("la evidencia registra el identificador del trabajo", text.includes(importJobId ?? "?"));
      check("la evidencia registra la huella del plan", text.includes(fingerprint ?? "?"));
      check("y no está dentro del árbol de trabajo", !evidenceDirectory.startsWith(ROOT));
    }

    exitCode = failed === 0 ? 0 : 1;
  } finally {
    console.log("\n[cierre] deteniendo PostgREST y el shim");
    await stack.stop();
  }
});

rmSync(evidenceDirectory, { recursive: true, force: true });

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
console.log(
  "NOTA: esto es la pila local desechable, no un proyecto hospedado. El límite de cuerpo de la\n" +
    "      pasarela, el statement_timeout hospedado y el catálogo propio de Supabase siguen sin\n" +
    "      probarse aquí.",
);
if (failed > 0) {
  console.error("RESULTADO: el ensayo de importación NO concilia. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: el operador importa el paquete real, concilia, repite sin duplicar, revierte sin\n" +
    "residuo y el adaptador de base de datos reproduce el documento aprobado desde las tablas.",
);
process.exit(exitCode);
