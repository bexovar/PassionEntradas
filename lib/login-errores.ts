// Qué le decimos al agente cuando el login no sale. Cada caso tiene su
// mensaje (lib/tienda-i18n, auth.err*): no es lo mismo una contraseña mal
// tipeada que una solicitud que todavía no se aprobó o una cuenta dada de
// baja. Puro y con tests; LoginForm solo lo aplica.

export type FalloLogin =
  /** Email o contraseña mal: un solo mensaje, sin decir cuál de los dos. */
  | "credenciales"
  /** Pidió acceso y la solicitud todavía no se aprobó (no tiene usuario). */
  | "revision"
  /** Tenía cuenta y se la dieron de baja (equipo desactivado o acceso revocado). */
  | "inactiva"
  /** No hubo respuesta útil: red, servidor caído, demasiados intentos. */
  | "red";

type ErrorAuth = { name?: string; status?: number; code?: string; message?: string };

/**
 * Lo que dice el error de signInWithPassword. "credenciales" queda como
 * candidato: si ese email tiene una solicitud pendiente, el mensaje es el de
 * revisión (ver conSolicitud).
 */
export function falloDeAuth(e: ErrorAuth): FalloLogin {
  // Desactivado desde Equipo: Auth lo tiene bloqueado (ban_duration).
  if (e.code === "user_banned") return "inactiva";
  if (e.code === "invalid_credentials") return "credenciales";
  // Sin respuesta del servidor (AuthRetryableFetchError, status 0), un 5xx o
  // el tope de intentos: no es culpa de lo que tipeó.
  if (e.name === "AuthRetryableFetchError") return "red";
  const status = e.status ?? 0;
  if (status === 0 || status === 429 || status >= 500) return "red";
  if (/fetch|network|timeout/i.test(e.message ?? "")) return "red";
  // Cualquier otro 4xx de Auth es de las credenciales.
  return "credenciales";
}

/** Un "credenciales" de alguien que pidió acceso y espera la aprobación. */
export function conSolicitud(fallo: FalloLogin, enRevision: boolean): FalloLogin {
  return fallo === "credenciales" && enRevision ? "revision" : fallo;
}

export type CamposLogin = { email?: "vacio"; password?: "vacio" };

/** Validación antes de enviar: los dos campos son obligatorios. */
export function camposFaltantes(email: string, password: string): CamposLogin {
  const faltan: CamposLogin = {};
  if (!email.trim()) faltan.email = "vacio";
  if (!password) faltan.password = "vacio";
  return faltan;
}
