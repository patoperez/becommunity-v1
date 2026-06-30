"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign in with email + password (§7.2). All validation happens on the server;
 * the browser never decides whether a login succeeds (§6.4).
 */
export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Correo y contraseña son obligatorios.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Generic message — do not leak whether the email exists.
    redirect(`/login?error=${encodeURIComponent("Credenciales inválidas.")}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
