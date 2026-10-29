import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { correrRecordatorios } from "@/lib/avisos-equipo";
import { isMock } from "@/lib/mock-db";
import { baseUrlDe } from "@/lib/base-url";
import { tokenWorkerValido } from "@/lib/token-worker";

// POST /api/recordatorios — revisa lo que quedó esperando (pedido sin
// confirmar 2 h, consulta sin cotizar 4 h, cotización por vencer, evento en
// 48 h sin entregar) y avisa al equipo: campana + UN WhatsApp por persona con
// lo nuevo. Cada ítem se avisa una sola vez (lib/avisos-equipo).
//
// Lo llama el WORKER en cada vuelta (cada 5 min), igual que /api/revalidar:
// así no hace falta un cron aparte (el gratis de Vercel corre una vez por
// día). Mismo secreto compartido (REVALIDAR_TOKEN, ver lib/token-worker).
export const dynamic = "force-dynamic";

function tokenValido(request: Request): boolean {
  if (isMock()) return true;
  return tokenWorkerValido(request.headers.get("x-revalidar-token"));
}


export async function POST(request: Request) {
  if (!tokenValido(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const r = await correrRecordatorios(isMock() ? null : createAdminSupabase(), new Date(), baseUrlDe(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error(`[recordatorios] ${(e as Error).message}`);
    return NextResponse.json({ error: "No se pudieron revisar los pendientes" }, { status: 500 });
  }
}
