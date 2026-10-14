"use client";

import { createClient } from "@/lib/supabase/client";
import { avisarActividad } from "@/lib/actividad-cliente";

export default function LogoutButton() {
  async function logout() {
    // Antes del signOut: después ya no hay sesión a quién atribuirlo.
    await avisarActividad("sesion.salida");
    const supabase = createClient();
    await supabase.auth.signOut();
    // Navegación dura: el panel (Tailwind) sale al login (CSS de la tienda);
    // un soft-nav cruzaba stylesheets y renderizaba sin estilos hasta refrescar.
    window.location.assign("/ingresar");
  }

  return (
    // Mismas medidas que las otras acciones del header (40px táctil / 36px
    // desktop); min-h-0 para que el global táctil no lo agrande de más.
    <button
      onClick={logout}
      className="inline-flex h-10 min-h-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 md:h-9"
    >
      Salir
    </button>
  );
}
