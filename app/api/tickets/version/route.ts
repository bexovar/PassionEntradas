import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock, mockGetPortalActivo, mockListManual, mockSyncRuns } from "@/lib/mock-db";

// GET /api/tickets/version — { v } que cambia solo si cambió algo de lo que
// muestra Entradas: las entradas propias (cantidad + última edición, incluido
// el stock que mueve un pedido), la última sincronización con Passion (trae
// los contadores del catálogo) y el interruptor del portal. La pantalla la
// consulta cada 30 s y se re-renderiza solo cuando cambió, en vez de pedir la
// página entera cada vez. Solo administrador, como la pantalla.
export const dynamic = "force-dynamic";

export async function GET() {
  if (isMock()) {
    const manual = mockListManual();
    const max = manual.reduce((m, t) => (t.updated_at && t.updated_at > m ? t.updated_at : m), "");
    const sync = mockSyncRuns()[0]?.id ?? "";
    return NextResponse.json({ v: `${manual.length}:${max}|${sync}|${mockGetPortalActivo() ? 1 : 0}` });
  }

  const {
    data: { user },
  } = await createServerSupabase().auth.getUser();
  if (!user || getRol(user) !== "administrador") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const [manual, sync, portal] = await Promise.all([
    admin
      .from("tickets")
      .select("updated_at", { count: "exact" })
      .eq("source", "manual")
      .order("updated_at", { ascending: false })
      .limit(1),
    admin.from("sync_runs").select("id").order("id", { ascending: false }).limit(1),
    admin.from("config").select("value, updated_at").eq("key", "portal_activo").maybeSingle(),
  ]);
  if (manual.error || sync.error || portal.error) {
    return NextResponse.json({ error: "No se pudo leer" }, { status: 500 });
  }
  const ultima = (manual.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? "";
  const run = (sync.data?.[0] as { id?: number } | undefined)?.id ?? "";
  const p = portal.data as { value?: number; updated_at?: string } | null;
  return NextResponse.json({
    v: `${manual.count ?? 0}:${ultima}|${run}|${p?.value ?? ""}:${p?.updated_at ?? ""}`,
  });
}
