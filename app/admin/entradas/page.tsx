import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import AutoRefresh from "@/components/AutoRefresh";
import BottomNav from "@/components/BottomNav";
import TicketsPanel from "@/components/admin/TicketsPanel";
import MargenesPanel from "@/components/admin/MargenesPanel";
import TextosPagoPanel from "@/components/admin/TextosPagoPanel";
import { hoyArgentina, type SyncRun, type TicketFull } from "@/lib/tickets";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import {
  isMock,
  MOCK_USER,
  mockGetPortalActivo,
  mockListManual,
  mockPortalCount,
  mockSyncRuns,
} from "@/lib/mock-db";

export const dynamic = "force-dynamic";

// Gestión del catálogo de la tienda: carga manual de entradas propias y
// estado de la sincronización del worker (portal Passion Events).
export default async function AdminEntradasPage() {
  let email: string | null | undefined;
  let manual: TicketFull[];
  let syncRuns: SyncRun[];
  let portalCount: number;
  let portalComprables: number;
  let portalActivo: boolean;
  let competiciones: string[];

  if (isMock()) {
    email = MOCK_USER.email;
    manual = mockListManual();
    syncRuns = mockSyncRuns();
    portalCount = mockPortalCount();
    portalComprables = portalCount;
    portalActivo = mockGetPortalActivo();
    const { MOCK_TICKETS } = await import("@/lib/mock-tickets");
    competiciones = Array.from(
      new Set(
        [...MOCK_TICKETS, ...manual]
          .map((t) => t.competicion)
          .filter((c): c is string => !!c)
      )
    ).sort();
  } else {
    const supabase = createServerSupabase();
    const user = await usuarioVerificado();

    if (!user) redirect("/ingresar");
    if (getRol(user) !== "administrador") redirect("/moderador");
    email = user.email;

    // Los conteos del portal excluyen eventos ya pasados: las filas viejas
    // quedan en la tabla (regla anti-borrado del worker) pero no cuentan
    // como catálogo. "Comprables" = con stock y reservables ahora.
    // Mismo día de corte que la tienda (hora argentina).
    const hoy = hoyArgentina();
    const [manualRes, syncRes, countRes, comprablesRes, portalRes, compsRes] = await Promise.all([
      supabase
        .from("tickets")
        .select("*")
        .eq("source", "manual")
        .order("fecha", { ascending: true, nullsFirst: false })
        .limit(1000),
      supabase
        .from("sync_runs")
        .select(
          "id,status,reason,scraped_valid,upserted,marked_unavailable,complete,duration_ms,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("source", "portal")
        .or(`fecha.is.null,fecha.gte.${hoy}`),
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("source", "portal")
        .eq("estado", "book")
        .eq("disponible", true)
        .gt("stock", 0)
        .or(`fecha.is.null,fecha.gte.${hoy}`),
      // Interruptor de Passion (config es legible por usuarios logueados).
      supabase.from("config").select("value").eq("key", "portal_activo").maybeSingle(),
      // Competiciones existentes (portal + propias, vigentes) para el
      // dropdown del form. DISTINCT en la base: bajar una fila por ticket
      // chocaba con el tope de 1000 de PostgREST y faltaban competiciones.
      supabase.rpc("competiciones_catalogo", { p_solo_portal: false }),
    ]);
    manual = (manualRes.data ?? []) as TicketFull[];
    syncRuns = (syncRes.data ?? []) as SyncRun[];
    portalCount = countRes.count ?? 0;
    portalComprables = comprablesRes.count ?? 0;
    // Sin fila = activado (default histórico).
    portalActivo = portalRes.data == null || Number(portalRes.data.value) !== 0;
    competiciones = (compsRes.data ?? []) as string[];
  }

  return (
    <main className="min-h-svh pb-16 md:pb-10">
      <AppHeader subtitle="Entradas de la tienda" email={email} nav />
      <TicketsPanel
        initial={manual}
        syncRuns={syncRuns}
        portalCount={portalCount}
        portalComprables={portalComprables}
        portalActivo={portalActivo}
        competiciones={competiciones}
      />
      <div className="mx-auto w-full max-w-5xl px-4 pb-6">
        <MargenesPanel />
        <TextosPagoPanel />
      </div>
      <AutoRefresh intervalMs={30000} versionUrl="/api/tickets/version" />
      <BottomNav />
    </main>
  );
}
