import { NextResponse } from "next/server";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { isMock } from "@/lib/mock-db";
import { tokenWorkerValido } from "@/lib/token-worker";

// POST /api/revalidar — refresca las páginas cacheadas de la tienda YA.
// Lo llama el WORKER al terminar cada sync publicado: él escribe directo en
// la base (la app no se entera) y sin esto los cambios tardaban hasta la
// revalidación de fondo (10 min) en verse.
//
// Auth por secreto compartido con el worker (REVALIDAR_TOKEN, ver
// lib/token-worker). Comparación en tiempo constante.

function tokenValido(request: Request): boolean {
  // Demo local sin claves: abierto (isMock nunca es true en producción).
  if (isMock()) return true;
  return tokenWorkerValido(request.headers.get("x-revalidar-token"));
}

export async function POST(request: Request) {
  if (!tokenValido(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  refrescarTienda();
  return NextResponse.json({ ok: true });
}
