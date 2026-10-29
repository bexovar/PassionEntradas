import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { TAG_CATALOGO } from "@/lib/refrescar-tienda";
import { esProduccion, modoDemo } from "@/lib/entorno";
import {
  DEFAULT_EUR_USD,
  hoyArgentina,
  sinEventosPasados,
  type Ticket,
} from "@/lib/tickets";

// Cliente público (anon, sin cookies) para leer el catálogo desde
// Server Components. RLS permite SELECT sobre `tickets` al rol anon.
export function createPublicSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function fetchTickets(): Promise<Ticket[]> {
  // Modo demo: MOCK_DATA=1 fuerza el catálogo de muestra; si Supabase está
  // caído, se usa como fallback para poder seguir desarrollando.
  // En todos los caminos se filtran los eventos ya pasados: el worker no los
  // vuelve a traer, pero las filas viejas quedan en la tabla y no tienen que
  // aparecer en la tienda.
  if (modoDemo()) {
    const { MOCK_TICKETS } = await import("@/lib/mock-tickets");
    const { mockListManual } = await import("@/lib/mock-db");
    // Portal mockeado + manuales del mock-db (así lo cargado desde el panel
    // demo aparece en la tienda).
    return sinEventosPasados([
      ...MOCK_TICKETS.filter((t) => t.source === "portal"),
      ...mockListManual(),
    ]);
  }
  try {
    return sinEventosPasados(await catalogoCacheado(hoyArgentina()));
  } catch (err) {
    // En producción, un catálogo de muestra serían entradas y precios
    // inventados que se pueden pedir: mejor la tienda vacía por un rato.
    if (esProduccion()) {
      console.error("[tienda] Supabase no disponible, catálogo vacío:", err);
      return [];
    }
    console.warn("[tienda] Supabase no disponible, usando catálogo mock:", err);
    const { MOCK_TICKETS } = await import("@/lib/mock-tickets");
    return sinEventosPasados(MOCK_TICKETS);
  }
}

type FilaCatalogo = Ticket & { disponible: boolean };

// El catálogo es el mismo para todos los clientes: se lee UNA vez por minuto
// (Data Cache de Next, compartido entre requests) en vez de en cada visita.
// Cualquier cambio de stock, precio o config lo invalida al toque con
// refrescarTienda() (tag TAG_CATALOGO). `hoy` va en la clave: al cambiar el día
// es otra entrada. Si falla, tira y NO se cachea (el llamador cae al mock).
const catalogoCacheado = unstable_cache(
  async (hoy: string): Promise<FilaCatalogo[]> => leerCatalogo(hoy),
  ["catalogo-v1"],
  { revalidate: 60, tags: [TAG_CATALOGO] }
);

async function leerCatalogo(hoy: string): Promise<FilaCatalogo[]> {
  const supabase = createPublicSupabase();
  // Una sola llamada: catalogo_tienda (0043) devuelve todo como un JSON.
  const { data, error } = await supabase.rpc("catalogo_tienda", { p_hoy: hoy });
  if (!error && Array.isArray(data)) return data as FilaCatalogo[];
  console.warn("[tienda] catalogo_tienda falló, leyendo paginado:", error?.message);
  return leerCatalogoPaginado(hoy);
}

// Lectura de antes (3 consultas en fila): queda de respaldo si la función no
// está. OJO: PostgREST devuelve como mucho 1000 filas por consulta, por eso
// pagina con range() hasta agotar. Mismos filtros que catalogo_tienda.
async function leerCatalogoPaginado(hoy: string): Promise<FilaCatalogo[]> {
  const supabase = createPublicSupabase();
  const PAGINA = 1000;
  const MAX_PAGINAS = 10; // red de seguridad
  let rows: FilaCatalogo[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase
      .from("tickets")
      .select(
        "id,evento,competicion,fecha,ciudad,categoria,precio_final,moneda_final,stock,estado,source,disponible,imagen_url,zona_color"
      )
      // Eventos vigentes (sin fecha o de hoy en adelante, día argentino).
      .or(`fecha.is.null,fecha.gte.${hoy}`)
      // NOT (book y retirada) = no-book O disponible. Las on_request
      // vigentes vienen con disponible=false por diseño y se quedan
      // (son las de "Consultar").
      .or("estado.neq.book,disponible.eq.true")
      .order("fecha", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(p * PAGINA, (p + 1) * PAGINA - 1);
    if (error) throw new Error(error.message);
    rows = rows.concat((data ?? []) as FilaCatalogo[]);
    if ((data ?? []).length < PAGINA) break;
  }
  return rows;
}

// Config de la tienda (tabla config, editable desde el panel):
// - eurUsd: cotización EUR->USD (portal Passion y propias en euros).
// - arsPorUsd: pesos por dólar (propias en pesos). null = no cargada.
// - portalActivo: si las entradas de Passion se muestran (false = solo propias).
// Ante cualquier error la tienda no se rompe, pero falla cerrada: el portal
// queda apagado (no se reactiva algo que el admin apagó) y la cotización cae
// al default.
export type ConfigTienda = { eurUsd: number; arsPorUsd: number | null; portalActivo: boolean };

export async function fetchConfigTienda(): Promise<ConfigTienda> {
  if (modoDemo()) {
    const { mockGetEurUsd, mockGetArsPorUsd, mockGetPortalActivo } = await import("@/lib/mock-db");
    return { eurUsd: mockGetEurUsd(), arsPorUsd: mockGetArsPorUsd(), portalActivo: mockGetPortalActivo() };
  }
  try {
    return await configCacheada();
  } catch (err) {
    console.error("[tienda] config no disponible, portal apagado por ahora:", err);
    return { eurUsd: DEFAULT_EUR_USD, arsPorUsd: null, portalActivo: false };
  }
}

// Misma caché que el catálogo (se invalida junto con él). Un error tira y no
// se cachea: el llamador usa los defaults solo para esa request.
const configCacheada = unstable_cache(leerConfigTienda, ["config-tienda-v1"], {
  revalidate: 60,
  tags: [TAG_CATALOGO],
});

async function leerConfigTienda(): Promise<ConfigTienda> {
  {
    const supabase = createPublicSupabase();
    const { data, error } = await supabase
      .from("config")
      .select("key, value")
      .in("key", ["eur_usd", "ars_por_usd", "portal_activo"]);
    if (error || !data) throw new Error(error?.message ?? "config vacía");
    const de = (key: string) => {
      const v = Number(data.find((r) => r.key === key)?.value);
      return Number.isFinite(v) ? v : null;
    };
    const eurUsd = de("eur_usd");
    const ars = de("ars_por_usd");
    const activo = de("portal_activo");
    return {
      eurUsd: eurUsd != null && eurUsd > 0 ? eurUsd : DEFAULT_EUR_USD,
      arsPorUsd: ars != null && ars > 0 ? ars : null,
      // Sin fila = activado (default histórico).
      portalActivo: activo == null ? true : activo !== 0,
    };
  }
}
