import "server-only";
import { runtimeShadowRecord, type ShadowRuntimeRecord } from "./diagnostics";
import type { ShadowDiagnostics } from "./contract";

/**
 * THE SERVER-ONLY DIAGNOSTIC SINK — off by default, and off unless a program
 * running in this process turns it on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Phase 3 left the runtime evidence in an impossible position:
 * the hosted page computed diagnostics and threw them away, while the only
 * thing that could read them — the command-line operator — did not exercise the
 * runtime path at all. So the one question that mattered, "what does a real
 * request actually do", had no answer that was both safe and available. This is
 * that answer: a place a real server run may deposit a record, with nothing
 * about it that could publish one.
 *
 * A NO-OP BY DEFAULT, AND NOT BECAUSE A FLAG IS UNSET. There is no environment
 * variable here, deliberately. A variable can be set on a deployment by
 * somebody who has not read this file; a function call cannot — the only way to
 * install a sink is for code running in this process to call
 * `installShadowDiagnosticBuffer` or `setShadowDiagnosticSink`, and the only
 * thing that does is `scripts/canonical-shadow-runtime-rehearsal.mjs`. With no
 * sink installed `recordShadowRun` projects nothing, allocates nothing and
 * returns.
 *
 * IT CANNOT ALTER THE LEGACY RESPONSE. It returns `void`, it is called after
 * the diagnostics are complete, and every call is wrapped: a sink that throws,
 * a sink that is not a function, a diagnostics object that is malformed — all
 * are swallowed here, because a diagnostic that could fail a request would be a
 * worse defect than the one it exists to detect.
 *
 * IT RECORDS CODES, NOT NUMBERS. Everything goes through `runtimeShadowRecord`,
 * which whitelists each field against the closed list it must belong to and
 * drops the four value/base fields entirely. A respondent value, a segment
 * value, a database message, a qualitative phrase or a small-sample aggregate
 * has no field to arrive in — see `diagnostics.ts`.
 *
 * IT ADDS NO ENDPOINT. The buffer is read by calling a function in the same
 * process. There is no route, no handler and no serialization path from here to
 * a response; `scripts/shadow-boundary-test.mjs` walks the import graph and
 * fails if any page, component or route reaches this module at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ShadowDiagnosticSink = (record: ShadowRuntimeRecord) => void;

/** Installed by an in-process operator, or null. Null is the shipped state. */
let installed: ShadowDiagnosticSink | null = null;

/** The ceiling on any buffer this module will hold. */
export const MAX_SHADOW_RECORD_BUFFER = 200;

/** Install a sink. Returns the previous one so a caller can restore it. */
export function setShadowDiagnosticSink(sink: ShadowDiagnosticSink | null): ShadowDiagnosticSink | null {
  const previous = installed;
  installed = typeof sink === "function" ? sink : null;
  return previous;
}

/** Remove any sink. After this the module is inert again. */
export function clearShadowDiagnosticSink(): void {
  installed = null;
}

/** True only when a program in this process installed one. */
export function hasShadowDiagnosticSink(): boolean {
  return installed !== null;
}

/**
 * Hand one completed run to the installed sink, if there is one.
 *
 * Never throws, never returns a value, and never runs the projection when no
 * sink is installed — so the shipped configuration does no work at all.
 *
 * ⚠️ A `try/catch` ALONE IS NOT ENOUGH, and that is not obvious. A sink is
 * declared to return `void`, and TypeScript's void-return assignability lets
 * an `async` function satisfy that signature with no error at all — so a
 * rejection from one would sail past this `catch` and land in a request as an
 * unhandled rejection. Anything thenable is neutralised here the same way
 * `orchestrate.ts` neutralises a late canonical read.
 */
export function recordShadowRun(diagnostics: ShadowDiagnostics): void {
  const sink = installed;
  if (sink === null) return;
  try {
    const outcome = sink(runtimeShadowRecord(diagnostics)) as unknown;
    if (outcome !== null && typeof outcome === "object" && typeof (outcome as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(outcome).catch(() => undefined);
    }
  } catch {
    /* A sink that fails is a sink that failed. The request is not affected. */
  }
}

export type ShadowDiagnosticBuffer = {
  /** A copy of what has been recorded, oldest first. */
  records: () => ShadowRuntimeRecord[];
  /** Uninstall this buffer, restoring whatever was installed before it. */
  dispose: () => void;
};

/**
 * The internal operator's way in: a BOUNDED in-memory ring buffer.
 *
 * Bounded because an unbounded one is a memory leak with a diagnostic's name
 * on it, and because a record is small and recent records are the ones anybody
 * asks about. Older records are dropped silently — the buffer's contract is
 * "the last N", not "all of them".
 */
export function installShadowDiagnosticBuffer(options: { capacity?: number } = {}): ShadowDiagnosticBuffer {
  const requested = options.capacity;
  const capacity =
    typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, MAX_SHADOW_RECORD_BUFFER)
      : MAX_SHADOW_RECORD_BUFFER;

  const kept: ShadowRuntimeRecord[] = [];
  const sink: ShadowDiagnosticSink = (record) => {
    kept.push(record);
    while (kept.length > capacity) kept.shift();
  };
  const previous = setShadowDiagnosticSink(sink);

  return {
    // A COMPLETE copy, not a shallow one. `counts` is a nested object, and a
    // caller handed the buffer's own reference could rewrite the totals of a
    // record that has already been recorded.
    records: () =>
      kept.map((record) => ({
        ...record,
        counts: { ...record.counts },
        findings: record.findings.map((item) => ({ ...item })),
      })),
    dispose: () => {
      if (installed === sink) setShadowDiagnosticSink(previous);
    },
  };
}
