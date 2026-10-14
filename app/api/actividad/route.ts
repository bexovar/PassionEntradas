import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad } from "@/lib/actividad";

// POST /api/actividad — lo que pasa en el navegador y no por nuestra API:
// ingresar, salir, cambiar la contraseña, los datos o el idioma (van directo
// a Supabase Auth). El navegador avisa DESPUÉS de que salió bien; el server
// solo acepta estos eventos y siempre a nombre de la sesión, nunca de otro.
// Body: { evento: "sesion.ingreso" | "sesion.salida" | "cuenta.clave" |
//         "cuenta.datos" | "cuenta.idioma", campos?: string[], idioma?: "es"|"en" }

const RESUMEN: Record<string, string> = {
  "sesion.ingreso": "Ingresó",
  "sesion.salida": "Salió",
  "cuenta.clave": "Cambió su contraseña",
  "cuenta.datos": "Actualizó sus datos",
  "cuenta.idioma": "Cambió el idioma",
};

const CAMPOS = new Set(["nombre", "apellido", "telefono", "legajo", "email"]);

export async function POST(request: Request) {
  let body: { evento?: unknown; campos?: unknown; idioma?: unknown; via?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const evento = typeof body.evento === "string" ? body.evento : "";
  if (!RESUMEN[evento]) return NextResponse.json({ error: "Evento inválido" }, { status: 400 });

  let actor = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const {
      data: { user },
    } = await createServerSupabase().auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    actor = actorDe(user);
    // Un desactivado no tiene sesión útil; igual no se registra a su nombre.
    if (!getRol(user) && evento !== "sesion.salida") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const detalle: Record<string, unknown> = {};
  if (evento === "cuenta.datos" && Array.isArray(body.campos)) {
    // Solo QUÉ campos cambió, no los valores.
    detalle.campos = body.campos.filter((c): c is string => typeof c === "string" && CAMPOS.has(c));
  }
  if (evento === "cuenta.idioma" && (body.idioma === "es" || body.idioma === "en")) detalle.idioma = body.idioma;
  if (evento === "cuenta.clave" && body.via === "recuperar") detalle.via = "recuperar";

  let resumen = RESUMEN[evento];
  if (detalle.idioma) resumen += ` a ${detalle.idioma === "en" ? "inglés" : "castellano"}`;
  if (detalle.via === "recuperar") resumen += " (con el link de recuperación)";

  await registrarActividad(isMock() ? null : createAdminSupabase(), {
    actor,
    accion: evento,
    entidad: "usuario",
    entidad_id: actor?.id ?? null,
    resumen,
    detalle,
    origen: actor?.rol === "cliente" ? "tienda" : "panel",
  });
  return NextResponse.json({ ok: true });
}
