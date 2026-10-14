import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol } from "@/lib/auth";
import { isMock } from "@/lib/mock-db";
import { leerActividad } from "@/lib/actividad";

// GET /api/operaciones/[id]/actividad — el historial de la operación: cada
// paso marcado o desmarcado, quién y cuándo (también los intentos que el
// server rechazó). Para la tarjeta del panel; solo el equipo.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
  }
  if (!isMock()) {
    const {
      data: { user },
    } = await createServerSupabase().auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!esStaff(getRol(user))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const filas = await leerActividad(isMock() ? null : createAdminSupabase(), {
    operacionId: params.id,
    limite: 100,
  });
  return NextResponse.json({
    actividad: filas
      .slice()
      .reverse()
      .map((a) => ({
        id: a.id,
        created_at: a.created_at,
        quien: a.actor_nombre ?? a.actor_email ?? (a.origen === "sistema" ? "Sistema" : "Sin cuenta"),
        rol: a.actor_rol,
        accion: a.accion,
        resumen: a.resumen,
      })),
  });
}
