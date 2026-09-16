"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation/schemas";

/**
 * Sign in with email + password (§7.2). All validation happens on the server;
 * the browser never decides whether a login succeeds (§6.4). Inputs are parsed
 * with Zod (§5.3) and only fixed error CODES are surfaced — never raw input.
 */
export async function login(formData: FormData) {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");

  const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) {
    // Distinguish "missing" (both fields blank) from "malformed but present",
    // preserving the original UX without leaking which field was wrong.
    const bothPresent =
      typeof rawEmail === "string" && rawEmail.trim() !== "" &&
      typeof rawPassword === "string" && rawPassword !== "";
    redirect(`/login?error=${bothPresent ? "invalid_credentials" : "missing_fields"}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    /*
      TWO FAILURES, TWO SENTENCES. A 4xx from the auth service is a statement
      about the credentials and is answered generically, so nothing reveals
      whether the email exists. A transport failure — a refused connection, a
      reset, a timeout, a 5xx from the gateway — is a statement about the
      INFRASTRUCTURE, and telling that person their credentials are invalid is
      simply false. Neither branch carries the error's own text.
    */
    redirect(`/login?error=${isAuthTransportFailure(error) ? "service_unavailable" : "invalid_credentials"}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Did the sign-in attempt fail to REACH the auth service, as opposed to being
 * refused by it?
 *
 * `AuthApiError` with a 4xx is the service answering «no». An
 * `AuthRetryableFetchError`, an abort, a bare `TypeError: fetch failed` or a 5xx
 * from the gateway mean nothing was learned about the credentials at all. The
 * same distinction is drawn in `src/lib/supabase/middleware.ts`, for the same
 * reason and with the same closed rules.
 */
function isAuthTransportFailure(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const status = (error as { status?: number }).status;
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (name === "AuthRetryableFetchError") return true;
  if (typeof status === "number") return status >= 500;
  return name === "TypeError" || name === "FetchError";
}
