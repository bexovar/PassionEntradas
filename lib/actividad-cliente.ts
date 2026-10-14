// Desde el navegador: avisar al registro de actividad algo que pasó directo
// contra Supabase Auth (ingresar, salir, contraseña, datos, idioma). Nunca
// frena a la persona: si falla, no pasa nada.
export function avisarActividad(
  evento: "sesion.ingreso" | "sesion.salida" | "cuenta.clave" | "cuenta.datos" | "cuenta.idioma",
  extra: { campos?: string[]; idioma?: "es" | "en"; via?: "recuperar" } = {}
): Promise<void> {
  return fetch("/api/actividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ evento, ...extra }),
    // Sigue aunque la página navegue o se cierre justo después.
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
