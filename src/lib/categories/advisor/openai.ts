/**
 * The OpenAI adapter: a small typed HTTP client for the Responses API.
 *
 * WHERE THE `server-only` GUARD LIVES, AND WHY NOT HERE. This module reads no
 * environment variable and holds no credential of its own: the key arrives as a
 * parameter, is used in one header, and is never stored, logged or returned.
 * The module that DOES touch the secret is `./service.ts`, which reads
 * `process.env.OPENAI_API_KEY` and constructs this adapter — and that module
 * carries the guard. Keeping the boundary on exactly one module makes it
 * reviewable, and leaves this one a pure function of its options that the
 * category gate can exercise against a mocked `fetch` for every timeout,
 * refusal, rate limit and malformed response the product must survive. An
 * adapter nothing can test is a worse outcome than a second copy of a guard.
 *
 * WHY NOT THE SDK. This runs inside a Cloudflare Worker, where `nodejs_compat`
 * is not a guarantee that a Node library works — the repository already carries
 * one production incident from assuming otherwise (ExcelJS reaching
 * `process.umask()` at module load). The advisor needs one POST, a JSON body
 * and a timeout. Vendoring a dependency graph to obtain that would put a large
 * unaudited surface inside the request path for no capability, and Suite D's
 * pinning and advisory rules would then apply to all of it. `fetch` is native
 * to workerd.
 *
 * WHAT THIS FILE MAY NOT DO. Throw. Every network, protocol, refusal and
 * schema outcome is mapped to an `AdvisorOutcome` value so a caller cannot
 * accidentally take down a review screen by failing to catch something.
 *
 * THE KEY. Read from the environment at call time, sent in a header, never
 * logged, never returned, never stored, and never included in an error message
 * — the error mapper below deliberately discards the provider's response body
 * rather than echoing it, because an upstream error body is exactly the kind of
 * thing that quotes the credential back at you.
 */

import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  SYSTEM_PROMPT,
  VERDICT_JSON_SCHEMA,
  parseVerdict,
  redactionRefusal,
  userPrompt,
  verdictLabelRefusal,
  type AdvisorPackage,
} from "./contract";
import { FAILURE_MESSAGE, type AdvisorOutcome, type CategoryAdvisor } from "./provider";

const ENDPOINT = "https://api.openai.com/v1/responses";
/** Enough for one verdict. A runaway response is a malformed one. */
const MAX_OUTPUT_TOKENS = 700;

export type OpenAiAdvisorOptions = {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  /** Injected in tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * One controlled retry, and only for the failures a retry can fix.
 *
 * A timeout or a 5xx may be transient. A refusal, a malformed answer, a bad
 * credential or an unknown model will produce the identical result a second
 * time, and retrying them only doubles the cost and the latency of a screen
 * that is already going to fall back to manual review.
 */
const RETRYABLE = new Set(["timeout", "network", "server"]);

export function createOpenAiAdvisor(options: OpenAiAdvisorOptions): CategoryAdvisor {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: "openai",
    async advise(payload: AdvisorPackage, signal?: AbortSignal): Promise<AdvisorOutcome> {
      const refusal = redactionRefusal(payload);
      if (refusal) return { ok: false, failure: "redacted", message: refusal };

      let attempt = 0;
      for (;;) {
        const result = await callOnce(payload, options, doFetch, signal);
        const worthRetrying = RETRYABLE.has(result.retryClass ?? "");
        if (result.outcome.ok || !worthRetrying || attempt >= 1) return result.outcome;
        attempt += 1;
      }
    },
  };
}

/**
 * One call's result, plus why it might be worth repeating.
 *
 * `retryClass` is kept beside the outcome rather than inside it so the value
 * that reaches a caller is exactly an `AdvisorOutcome` — no internal field to
 * strip, and no way for retry bookkeeping to leak onto a screen.
 */
type Attempt = { outcome: AdvisorOutcome; retryClass?: string };

async function callOnce(
  payload: AdvisorPackage,
  options: OpenAiAdvisorOptions,
  doFetch: typeof fetch,
  outerSignal: AbortSignal | undefined,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const onAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        // `store: false` — the payload is a client's category vocabulary. It is
        // sent to obtain one opinion and must not be retained by the provider.
        store: false,
        reasoning: { effort: options.reasoningEffort },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: "json_schema",
            name: "category_verdict",
            strict: true,
            schema: VERDICT_JSON_SCHEMA,
          },
        },
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt(payload) }] },
        ],
      }),
    });

    if (!response.ok) return mapHttpError(response.status);

    const body: unknown = await response.json().catch(() => null);
    return interpret(body, payload, options);
  } catch (error) {
    // The provider's own text is deliberately not propagated. An upstream error
    // body can echo a request header, and a header here carries the key.
    const aborted = error instanceof Error && error.name === "AbortError";
    return aborted
      ? { outcome: { ok: false, failure: "timeout", message: FAILURE_MESSAGE.timeout }, retryClass: "timeout" }
      : { outcome: { ok: false, failure: "network", message: FAILURE_MESSAGE.network }, retryClass: "network" };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onAbort);
  }
}

/** Status codes, mapped without reading the body. */
function mapHttpError(status: number): Attempt {
  if (status === 401 || status === 403) {
    return { outcome: { ok: false, failure: "unauthorized", message: FAILURE_MESSAGE.unauthorized } };
  }
  if (status === 404) {
    return { outcome: { ok: false, failure: "model_unavailable", message: FAILURE_MESSAGE.model_unavailable } };
  }
  if (status === 429) {
    return { outcome: { ok: false, failure: "rate_limited", message: FAILURE_MESSAGE.rate_limited } };
  }
  if (status >= 500) {
    return { outcome: { ok: false, failure: "network", message: FAILURE_MESSAGE.network }, retryClass: "server" };
  }
  // A 400 from a strict schema is a contract error on our side, not the
  // model's. It reads as malformed so the screen falls back rather than
  // pretending the model refused.
  return { outcome: { ok: false, failure: "malformed", message: FAILURE_MESSAGE.malformed } };
}

type ResponseBody = {
  status?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/**
 * Read the Responses payload defensively.
 *
 * The output array carries reasoning items as well as the message, and a
 * refusal arrives as a content part rather than an error — so the shape is
 * walked rather than indexed, and anything unrecognised becomes `malformed`
 * instead of a thrown `TypeError` on a screen a consultant is using.
 */
function interpret(
  body: unknown,
  payload: AdvisorPackage,
  options: OpenAiAdvisorOptions,
): Attempt {
  if (!body || typeof body !== "object") {
    return { outcome: { ok: false, failure: "malformed", message: FAILURE_MESSAGE.malformed } };
  }
  const parsed = body as ResponseBody;

  for (const item of parsed.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal) {
        return { outcome: { ok: false, failure: "refused", message: FAILURE_MESSAGE.refused } };
      }
    }
  }

  // `incomplete` means the model was cut off — by the token ceiling or by the
  // provider. A truncated verdict is not a verdict.
  if (parsed.status === "incomplete") {
    return { outcome: { ok: false, failure: "malformed", message: FAILURE_MESSAGE.malformed } };
  }

  const text = (parsed.output ?? [])
    .flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text" && typeof part.text === "string")?.text;
  if (!text) return { outcome: { ok: false, failure: "malformed", message: FAILURE_MESSAGE.malformed } };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { outcome: { ok: false, failure: "malformed", message: FAILURE_MESSAGE.malformed } };
  }

  // Re-validated here even though Structured Outputs was strict. The guarantee
  // belongs to a system this one does not control, and the cost of checking is
  // a schema parse.
  const verdict = parseVerdict(json);
  if (!verdict.ok) return { outcome: { ok: false, failure: "malformed", message: verdict.error } };
  const labelProblem = verdictLabelRefusal(verdict.verdict, payload);
  if (labelProblem) return { outcome: { ok: false, failure: "malformed", message: labelProblem } };

  return {
    outcome: {
      ok: true,
      verdict: verdict.verdict,
      model: options.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      usage: parsed.usage
        ? {
            inputTokens: Number(parsed.usage.input_tokens ?? 0),
            outputTokens: Number(parsed.usage.output_tokens ?? 0),
          }
        : null,
      cached: false,
    },
  };
}
