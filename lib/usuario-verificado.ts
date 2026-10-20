import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

// Usuario de la request en una página del panel o de la tienda, validado
// contra el servidor de Auth (getUser). Corre en pdx1, al lado de Supabase:
// unos 20 ms. El middleware solo mira las claims del token (pueden tener hasta
// 1 h, ver lib/claims.ts); acá se confirma que la sesión sigue viva y que el
// rol y el "desactivado" son los de ahora, antes de mostrar datos.
export async function usuarioVerificado(): Promise<User | null> {
  return (await sesionVerificada()).user;
}

// Lo mismo, distinguiendo "no hay sesión" de "Auth no contestó" (caído, 5xx,
// red). Los endpoints que el panel consulta solos cada pocos segundos lo
// necesitan: con un 401 la pantalla da la sesión por cerrada y deja de
// actualizarse para siempre; con un 503 reintenta en el próximo tick.
export async function sesionVerificada(): Promise<{ user: User | null; authCaido: boolean }> {
  const {
    data: { user },
    error,
  } = await createServerSupabase().auth.getUser();
  return { user, authCaido: error?.name === "AuthRetryableFetchError" };
}
