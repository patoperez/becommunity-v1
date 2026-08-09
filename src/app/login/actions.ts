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
    // Generic code — do not leak whether the email exists.
    redirect(`/login?error=invalid_credentials`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
