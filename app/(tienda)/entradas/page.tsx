import { fetchConfigTienda, fetchDestacados, fetchTickets } from "@/lib/supabase/public";
import { normalizarPrecios } from "@/lib/tickets";
import { StorefrontHome } from "@/components/tienda/Storefront";
import { requireAccesoTienda } from "@/lib/tienda-guard";
import { resumenHome } from "@/lib/resumen-home";

// Home de la tienda (entradas de Passion). Antes vivía en "/", ahora es la
// zona logueada: la landing pública quedó en "/" y tanto el middleware como
// esta página exigen sesión con acceso (staff o cliente aprobado).
//
// Dinámica: el guard lee la sesión (cookies) para reafirmar el acceso en el
// servidor, así que no se prerenderiza estática.
export const dynamic = "force-dynamic";

export default async function EntradasHome() {
  await requireAccesoTienda();

  let rows: Awaited<ReturnType<typeof fetchTickets>> = [];
  let cfg: Awaited<ReturnType<typeof fetchConfigTienda>> = {
    eurUsd: 1.08,
    arsPorUsd: null,
    portalActivo: true,
  };
  // Los destacados nunca tiran: sin ellos la tienda muestra los comprables.
  const destacadosP = fetchDestacados();
  try {
    [rows, cfg] = await Promise.all([fetchTickets(), fetchConfigTienda()]);
  } catch {
    return <div className="splash err">We could not load the listings.</div>;
  }
  // Interruptor del panel: con Passion apagado quedan solo las propias.
  if (!cfg.portalActivo) rows = rows.filter((t) => t.source !== "portal");
  // Todo a USD antes de renderizar: la tienda no vuelve a convertir.
  // La home solo muestra un resumen: se calcula acá y viaja solo eso.
  return <StorefrontHome resumen={resumenHome(normalizarPrecios(rows, cfg), await destacadosP)} />;
}
