// Desde el navegador: avisar al registro de actividad algo que pasó directo
// contra Supabase Auth (ingresar, salir, contraseña, datos, idioma). Nunca
// frena a la persona: si falla, no pasa nada.
// Quien espera (ingresar, salir) no espera más que esto: el pedido sigue
// igual en segundo plano (keepalive) aunque la página ya haya navegado.
const ESPERA_MAX_MS = 2000;

export function avisarActividad(
  evento: "sesion.ingreso" | "sesion.salida" | "cuenta.clave" | "cuenta.datos" | "cuenta.idioma",
  extra: { campos?: string[]; idioma?: "es" | "en"; via?: "recuperar" } = {}
): Promise<void> {
  const envio = fetch("/api/actividad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ evento, ...extra }),
    // Sigue aunque la página navegue o se cierre justo después.
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
  return Promise.race([envio, new Promise<void>((r) => setTimeout(r, ESPERA_MAX_MS))]);
}
