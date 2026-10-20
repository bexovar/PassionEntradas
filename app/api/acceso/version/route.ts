import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { sesionVerificada } from "@/lib/usuario-verificado";
import { getRol } from "@/lib/auth";
import { isMock, mockListSolicitudes } from "@/lib/mock-db";

// GET /api/acceso/version — { v } que cambia solo si llegó o se tocó una
// solicitud de acceso (cantidad + última edición). Solicitudes la consulta
// cada 20 s y se re-renderiza solo cuando cambió, en vez de pedir la página
// entera cada vez. Solo administrador, como la pantalla.
export const dynamic = "force-dynamic";

export async function GET() {
  if (isMock()) {
    const sols = mockListSolicitudes();
    const max = sols.reduce((m, s) => (s.updated_at && s.updated_at > m ? s.updated_at : m), "");
    return NextResponse.json({ v: `${sols.length}:${max}` });
  }

  const { user, authCaido } = await sesionVerificada();
  // Auth no contestó: 503 para que la pantalla reintente (un 401 la daría por
  // deslogueada y dejaría de actualizarse).
  if (authCaido) return NextResponse.json({ error: "Auth no disponible" }, { status: 503 });
  if (!user || getRol(user) !== "administrador") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, count, error } = await createAdminSupabase()
    .from("solicitudes_acceso")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    return NextResponse.json({ error: "No se pudo leer" }, { status: 500 });
  }
  const ultima = (data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? "";
  return NextResponse.json({ v: `${count ?? 0}:${ultima}` });
}
