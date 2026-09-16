/**
 * Login error-code allowlist (§5.3 input validation, applied to the URL param).
 * The login action redirects with a fixed CODE (never free text); this page-side
 * map turns a known code into a safe, localized message. An unknown/absent code
 * renders nothing — so no attacker-chosen string from `?error=` is ever shown.
 * (JSX already escapes; this removes the surface entirely.)
 */
export const AUTH_ERROR_MESSAGES = {
  missing_fields: "Correo y contraseña son obligatorios.",
  invalid_credentials: "Credenciales inválidas.",
  /*
    ⓘ «TU CONTRASEÑA ESTÁ MAL» AND «NO PUDIMOS PREGUNTAR» ARE DIFFERENT FACTS.
    The sign-in call returns both as an `error`, and the action used to answer
    both with `invalid_credentials` — so during an auth outage every person
    trying to sign in was told their own credentials were wrong, which is untrue,
    unactionable, and sends them to reset a password that was never the problem.
  */
  service_unavailable:
    "No pudimos comprobar tus datos ahora mismo. No es tu contraseña: vuelve a intentarlo en unos segundos.",
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

/** Map a raw `?error=` value to a known message, or null if not on the allowlist. */
export function authErrorMessage(code: string | undefined): string | null {
  if (code && code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[code as AuthErrorCode];
  }
  return null;
}
