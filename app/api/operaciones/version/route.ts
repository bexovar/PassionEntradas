import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { sesionVerificada } from "@/lib/usuario-verificado";
import { esStaff, getRol } from "@/lib/auth";
import { isMock, mockListConsultas, mockListOps } from "@/lib/mock-db";

// GET /api/operaciones/version — versión mínima de la lista de operaciones.
// Devuelve { v } donde v cambia si se creó/actualizó cualquier operación
// (cantidad + updated_at más reciente). AutoRefresh la consulta en intervalo
// y solo re-renderiza el panel cuando cambió: unos bytes por tick en vez de
// re-traer toda la página.
export const dynamic = "force-dynamic";

export async function GET() {
  if (isMock()) {
    // Espejo de version_operaciones (0041): operaciones + consultas.
    const ops = mockListOps();
    const max = ops.reduce((m, o) => (o.updated_at > m ? o.updated_at : m), "");
    const cs = mockListConsultas();
    const maxC = cs.reduce((m, c) => (c.updated_at > m ? c.updated_at : m), "");
    return NextResponse.json({ v: `${ops.length}:${max}|${cs.length}:${maxC}` });
  }

  const { user, authCaido } = await sesionVerificada();
  // Auth no contestó: 503 para que el panel reintente (un 401 lo daría por
  // deslogueado y dejaría de actualizarse).
  if (authCaido) return NextResponse.json({ error: "Auth no disponible" }, { status: 503 });
  // Solo staff: este endpoint delata cuántas operaciones hay y cuándo se tocó
  // la última. Un cliente logueado no tiene por qué verlo (y no lo usa: "Mis
  // pedidos" refresca sin consultar versión).
  if (!user || !esStaff(getRol(user))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // RPC único ("count:max(updated_at)"), respaldado por el índice
  // operaciones_updated_at_idx: este endpoint se polea cada 15s por admin
  // conectado, tiene que ser barato aunque la tabla crezca.
  const { data, error } = await createAdminSupabase().rpc("version_operaciones");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ v: String(data ?? "") });
}
