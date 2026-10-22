import type { User } from "@supabase/supabase-js";

// El usuario tal como viene en el token de sesión (claims del JWT), ya con la
// firma verificada por supabase.auth.getClaims().
//
// Para qué: el middleware corre en el borde de Vercel más cercano a quien
// navega (San Pablo para la Argentina), no en pdx1 como el resto de la app.
// Preguntarle a Auth "¿quién es?" desde ahí era un viaje a Oregon en CADA
// cambio de página: 0,3 s la mediana y más de 15 s en el 5 % peor (medido en
// los logs de Supabase, octubre 2026). Las claims se verifican localmente con
// la clave pública del proyecto (ES256), sin viaje.
//
// Lo que NO dan: frescura. El token vale hasta 1 h, así que un cambio de rol
// o un "desactivar" de Equipo se ve en las claims recién al renovarse. Por eso
// el middleware solo las usa para dejar pasar; cuando con ellas tendría que
// sacar a alguien (redirect o cerrar sesión) confirma con getUser(), y cada
// página y API vuelve a validar con getUser() desde pdx1 antes de mostrar o
// tocar datos.

export type UsuarioDeClaims = Pick<User, "id" | "email" | "app_metadata" | "user_metadata">;

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** El usuario de las claims, o null si no hay sesión (o el token no trae `sub`). */
export function usuarioDeClaims(claims: unknown): UsuarioDeClaims | null {
  const c = objeto(claims);
  const sub = c.sub;
  if (typeof sub !== "string" || !sub) return null;
  // Un token anónimo o de servicio no es una sesión de la app.
  if (c.role !== undefined && c.role !== "authenticated") return null;
  return {
    id: sub,
    email: typeof c.email === "string" && c.email ? c.email : undefined,
    app_metadata: objeto(c.app_metadata) as User["app_metadata"],
    user_metadata: objeto(c.user_metadata),
  };
}
