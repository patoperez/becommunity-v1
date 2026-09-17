"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordRuntimeFailure } from "@/lib/runtime/unavailable";
import { createClient } from "@/lib/supabase/server";
import { classifySignIn } from "@/lib/upstream/outcome";
import { loginSchema } from "@/lib/validation/schemas";
import { signInErrorCode, signInFailureLogCode } from "./errors";

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

  // The client is BOUNDED (`src/lib/supabase/server.ts`): a sign-in the auth
  // service never answers ends at the per-attempt limit, as a timeout, instead
  // of holding the form open. auth-js does not retry a sign-in, so the attempt
  // bound is the operation's bound — no second deadline is needed, and none is
  // added, because abandoning a sign-in that might still succeed would sign a
  // person in behind an error message.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    /*
      TWO FAILURES, TWO SENTENCES. A 4xx from the auth service is a statement
      about the credentials and is answered generically, so nothing reveals
      whether the email exists. A transport failure — a refused connection, a
      reset, a timeout, a 5xx from the gateway, a throttle — is a statement about
      the INFRASTRUCTURE, and telling that person their credentials are invalid
      is simply false. Neither branch carries the error's own text.

      Since Unit 6B.4B2P the classification is the shared one in
      `src/lib/upstream/outcome.ts`, which the middleware uses too, so the two
      cannot drift apart; and the infrastructure case is now logged.
    */
    const outcome = classifySignIn(error);
    const logCode = signInFailureLogCode(outcome);
    if (logCode) recordRuntimeFailure({ code: logCode, pathname: "/login", method: "POST" });
    redirect(`/login?error=${signInErrorCode(outcome)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
