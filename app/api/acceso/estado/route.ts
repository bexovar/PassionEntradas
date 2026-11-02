import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { isMock, mockListSolicitudes } from "@/lib/mock-db";

// POST /api/acceso/estado — PÚBLICO. Lo llama el login cuando Auth dice
// "email o contraseña incorrectos": si ese email pidió acceso y la solicitud
// sigue pendiente, todavía no tiene usuario, y el mensaje correcto es "tu
// solicitud está en revisión", no "contraseña incorrecta".
//
// Solo contesta sí/no sobre una solicitud PENDIENTE: nada de datos de la
// solicitud ni de si el email tiene cuenta. Es lo que pide el login (TKT-7);
// lo que deja saber es que ese email pidió acceso y espera respuesta.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 160);
  if (!email.includes("@")) return NextResponse.json({ enRevision: false });

  if (isMock()) {
    const enRevision = mockListSolicitudes().some(
      (s) => s.estado === "pendiente" && s.email.toLowerCase() === email
    );
    return NextResponse.json({ enRevision });
  }

  const { count, error } = await createAdminSupabase()
    .from("solicitudes_acceso")
    .select("id", { count: "exact", head: true })
    .eq("estado", "pendiente")
    .eq("email", email);
  // Si no se pudo mirar, se queda el mensaje genérico de credenciales.
  return NextResponse.json({ enRevision: !error && (count ?? 0) > 0 });
}
