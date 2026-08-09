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
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

/** Map a raw `?error=` value to a known message, or null if not on the allowlist. */
export function authErrorMessage(code: string | undefined): string | null {
  if (code && code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[code as AuthErrorCode];
  }
  return null;
}
