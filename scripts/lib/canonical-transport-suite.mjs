// =============================================================================
// The TRANSPORT suite — the questions only level 3 can answer
// =============================================================================
// `canonical-suite.mjs` asks what the DATABASE does. This file asks what the
// TRANSPORT does, and every case here is meaningless over `psql`:
//
//   T1  a request body the size of the real package actually reaches the
//       function, rather than being rejected by a gateway or a body limit;
//   T3  supabase-js hands back the jsonb result in the shape `flow.ts` reads,
//       with no array wrapper and no `{ <function name>: … }` envelope;
//   T4  a `raise … using message = 'COMMITTED_PAYLOAD_DIFFERS'` survives
//       PostgREST, supabase-js and `safeErrorCode` as THAT code — not as the
//       catch-all `CLIENT_TRANSPORT`, which would silently turn a business
//       refusal into "the network failed";
//   T5  which of the thirty codes in `COMMIT_ERROR_MESSAGES` this run actually
//       observed coming back as themselves, and which it did not exercise;
//   T8  the service-role KEY confers what `set role service_role` simulated;
//   T9  an anon key is refused on all four functions, over HTTP.
//
// It is run ONLY by the hosted runner. Adding it to the local gate would be a
// lie: `psqlTransport` hands the server a file path, so it has no request body
// to limit, no HTTP status to return and no key to present.
//
// -----------------------------------------------------------------------------
// HOW T1 IS BUILT, AND WHY IT IS NOT THE REAL WORKBOOKS
// -----------------------------------------------------------------------------
// The target size is the real package's measured plan (2.58 MiB), but the BYTES
// are the synthetic fixtures': the projected synthetic plan's largest family is
// replicated, with distinct derived keys, until the serialized plan reaches that
// size. It is then sent under an import job id that does not exist, so the
// function refuses with `JOB_NOT_FOUND` before it looks at a single row. That
// refusal is the proof: a business error means the body arrived and was parsed.
// An HTTP 413, a 5xx from a gateway, or `status === 0` means it did not.
//
// No real workbook is opened, and no respondent value exists anywhere in this
// payload.
// =============================================================================

import { COMMIT_ERROR_MESSAGES, safeErrorCode } from "../../src/lib/ingestion/canonical-commit/result.ts";
import { runCanonicalCommit, runCanonicalRollback } from "../../src/lib/ingestion/canonical-commit/flow.ts";

/** The measured plan size of the real Cuicuilco package, in bytes. */
export const REAL_PLAN_BYTES = 2_705_000;

/** A job id of the right shape that cannot exist. */
const ABSENT_JOB_ID = "00000000-0000-4000-8000-0000000000ff";

const serializedBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * Grow a projected plan to `targetBytes` by replicating its own largest family.
 *
 * Every added row is a copy of a real projected row with a distinct derived
 * key, so the payload is the fixtures' own vocabulary at the real package's
 * scale. It is deliberately NOT a valid plan any more — it is a body, and T1
 * measures whether a body of that size arrives.
 */
export function scalePlanToBytes(plan, targetBytes) {
  const scaled = JSON.parse(JSON.stringify(plan));
  const family = Object.entries(scaled)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .sort(([, a], [, b]) => serializedBytes(b) - serializedBytes(a))[0];
  if (!family) throw new Error("the projected plan has no array family to scale.");
  const [name, rows] = family;
  const template = rows[0];
  const perRow = serializedBytes(template) + 1;
  let index = 0;
  while (serializedBytes(scaled) < targetBytes) {
    const needed = Math.max(1, Math.ceil((targetBytes - serializedBytes(scaled)) / perRow));
    for (let i = 0; i < needed; i += 1) {
      const copy = JSON.parse(JSON.stringify(template));
      if (typeof copy.id === "string") copy.id = `${copy.id.slice(0, 24)}${String(index).padStart(12, "0")}`;
      copy.__scaleIndex = index;
      scaled[name].push(copy);
      index += 1;
    }
  }
  return { plan: scaled, family: name, addedRows: index, bytes: serializedBytes(scaled) };
}

/** Wrap a transport so the raw result of one RPC can be inspected. */
function capturing(t, seen) {
  return {
    rpc: async (name, args) => {
      const answer = await t.rpc(name, args);
      seen.push({ name, data: answer.data, error: answer.error });
      return answer;
    },
  };
}

export async function transportSuite(t, ctx) {
  const ledger = ctx.ledger;
  const { check, bad, skip } = ledger;
  if (t.kind !== "rest") {
    for (const id of ["T1", "T3", "T4", "T5", "T8", "T9"]) {
      skip(id, "httpTransport", "these questions are about HTTP, which this transport does not use");
    }
    return;
  }

  console.log("\n[transport] the questions only an HTTP transport can answer");
  await t.prepare();
  const scope = await t.createStudy("transport");
  const observed = ctx.observedCodes ?? new Set();
  const seen = [];

  // ---- a real commit, with its raw result captured -------------------------
  const committed = await runCanonicalCommit(capturing(t, seen), {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: [ctx.cleanFile, ctx.painFile],
  });
  check("T3.0", committed.ok === true, `the synthetic package commits over HTTP (${committed.ok ? "ok" : committed.code})`);

  const rawCommit = seen.filter((entry) => entry.name === "commit_canonical_package" && entry.data).pop();
  check("T3.1", rawCommit !== undefined && rawCommit.data !== null, "supabase-js returns the function's jsonb result");
  const body = rawCommit?.data;
  check(
    "T3.2",
    body !== null && typeof body === "object" && !Array.isArray(body),
    `unwrapped — a bare object, not an array and not a named envelope (${Array.isArray(body) ? "array" : typeof body})`,
  );
  for (const field of ["importJobId", "status", "replayed", "counts", "commitAttempts", "rollbackCount"]) {
    check("T3.3", body !== null && typeof body === "object" && field in body, `the result carries '${field}'`);
  }

  // ---- T4: a business refusal must NOT arrive as CLIENT_TRANSPORT ---------
  const tamperSeen = [];
  const captured = { plan: null, jobId: null };
  const capturingStage = {
    rpc: async (name, args) => {
      if (name === "commit_canonical_package") {
        captured.plan = args.p_plan;
        captured.jobId = args.p_import_job_id;
        return { data: null, error: { message: "HARNESS_STOP" } };
      }
      return t.rpc(name, args);
    },
  };
  await runCanonicalCommit(capturingStage, {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: [ctx.cleanFile, ctx.painFile],
  });
  if (!captured.plan) {
    bad("T4.1", "could not project a plan to tamper with");
  } else {
    const tampered = JSON.parse(JSON.stringify(captured.plan));
    tampered.participants = tampered.participants.slice(0, -1);
    tampered.expectedCounts.participants -= 1;
    const { error } = await capturing(t, tamperSeen).rpc("commit_canonical_package", {
      p_import_job_id: captured.jobId,
      p_plan: tampered,
    });
    const code = error ? safeErrorCode(error) : "ACCEPTED";
    observed.add(code);
    check("T4.1", code === "COMMITTED_PAYLOAD_DIFFERS", `a business refusal survives the transport as itself (${code})`);
    check("T4.2", code !== "CLIENT_TRANSPORT", "and is not flattened into CLIENT_TRANSPORT");
  }

  // ---- T1: a body the size of the real package ----------------------------
  if (!captured.plan) {
    skip("T1", "httpTransport", "no projected plan was available to scale");
  } else {
    const scaled = scalePlanToBytes(captured.plan, REAL_PLAN_BYTES);
    const started = process.hrtime.bigint();
    const { data, error } = await t.rpc("commit_canonical_package", {
      p_import_job_id: ABSENT_JOB_ID,
      p_plan: scaled.plan,
    });
    const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
    const code = error ? safeErrorCode(error) : `ACCEPTED:${data?.status ?? "?"}`;
    observed.add(code);
    check(
      "T1.1",
      code === "JOB_NOT_FOUND",
      `a ${(scaled.bytes / 1048576).toFixed(2)} MiB body (${scaled.bytes} bytes, ` +
        `${scaled.addedRows} scaled '${scaled.family}' rows) reached the function and was parsed — ` +
        `it answered ${code} in ${wallMs.toFixed(0)} ms`,
    );
    check(
      "T1.2",
      code !== "CLIENT_TRANSPORT",
      "so no gateway, proxy or body limit rejected it before PostgreSQL saw it",
    );
    ledger.timings.push(
      `T1: ${scaled.bytes} bytes accepted, answered ${code} in ${wallMs.toFixed(0)} ms`,
    );
  }

  // ---- T8 / T9: the key path, over HTTP -----------------------------------
  const FUNCTION_PROBES = [
    { name: "record_canonical_rows", rest: { p_import_job_id: ABSENT_JOB_ID, p_tenant_id: ABSENT_JOB_ID, p_study_id: ABSENT_JOB_ID, p_target_table: "person_private", p_ids: [], p_ownership: "created" } },
    { name: "stage_canonical_package", rest: { p_tenant_id: ABSENT_JOB_ID, p_study_id: ABSENT_JOB_ID, p_request: {} } },
    { name: "commit_canonical_package", rest: { p_import_job_id: ABSENT_JOB_ID, p_plan: {} } },
    { name: "rollback_canonical_package", rest: { p_import_job_id: ABSENT_JOB_ID, p_actor: null } },
  ];
  for (const probe of FUNCTION_PROBES) {
    const sqlstate = await t.probeFunctionExecute("service_role", probe.name, probe);
    check("T8.1", sqlstate !== "42501", `the service-role KEY may execute ${probe.name} (sqlstate ${sqlstate ?? "none"})`);
  }
  if (t.capabilities.roleSwitch) {
    for (const probe of FUNCTION_PROBES) {
      const sqlstate = await t.probeFunctionExecute("anon", probe.name, probe);
      check("T9.1", sqlstate === "42501", `an anon KEY is refused ${probe.name} (sqlstate ${sqlstate ?? "none — IT SUCCEEDED"})`);
    }
  } else {
    for (const id of ["T9.1"]) skip(id, "roleSwitch", "no anon key was supplied, so there is no second identity to refuse");
  }

  // ---- T5: which codes were actually seen coming back as themselves -------
  for (const entry of [...seen, ...tamperSeen]) {
    if (entry.error) observed.add(safeErrorCode(entry.error));
  }
  const declared = Object.keys(COMMIT_ERROR_MESSAGES);
  const roundTripped = [...observed].filter((code) => declared.includes(code) && code !== "CLIENT_TRANSPORT");
  const flattened = observed.has("CLIENT_TRANSPORT");
  check(
    "T5.1",
    !flattened,
    `no observed refusal was flattened into CLIENT_TRANSPORT (${roundTripped.length} of ${declared.length} codes exercised)`,
  );
  // Every code this run did NOT provoke is recorded as a SKIP, one per code.
  // Writing them as a single passing assertion would report thirty unexecuted
  // round trips as one green line, which is exactly the shape of lie this
  // ledger exists to prevent.
  for (const code of declared.filter((entry) => !observed.has(entry))) {
    skip("T5.2", "codeNotProvoked", `${code} was never raised over HTTP by this run, so its round trip is unproved`);
  }

  // ---- leave nothing behind ------------------------------------------------
  if (committed.ok) await runCanonicalRollback(t, committed.importJobId, null);
}
