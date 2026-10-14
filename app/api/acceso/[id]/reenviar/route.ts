import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { generarPassword, mensajeCredenciales } from "@/lib/acceso";
import { emailConfigurado } from "@/lib/email";
import { isMock, mockReenviarSolicitud } from "@/lib/mock-db";
import { bloqueoEnAccesos, rolEquipoDe } from "@/lib/equipo";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

function randomCrypto(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

function urlIngreso(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
    : new URL(request.url).origin;
  return `${base}/ingresar`;
}

// Línea del registro de actividad. La contraseña nueva NUNCA va al registro.
function actividadReenvio(
  actor: Actor | null,
  sol: { id: string; nombre: string; email: string; user_id: string | null }
): NuevaActividad {
  return {
    actor,
    accion: "acceso.reenviar",
    entidad: "solicitud",
    entidad_id: sol.id,
    codigo: null,
    resumen: `Generó una contraseña nueva para ${sol.nombre} (${sol.email}) para reenviarle el acceso`,
    detalle: { nombre: sol.nombre, email: sol.email, usuario_id: sol.user_id },
    origen: "panel",
  };
}

// POST /api/acceso/[id]/reenviar — SOLO administrador. Vuelve a generar el
// acceso de una solicitud YA aprobada: como la contraseña no se guarda, se
// regenera una nueva (updateUserById) y se devuelve para reenviarla (mensaje
// para copiar y/o email). Sirve para el "reenviar" desde el historial.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  if (isMock()) {
    const r = mockReenviarSolicitud(id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await registrarActividad(null, actividadReenvio(actorDemo(), r.solicitud));
    const mensaje = mensajeCredenciales({
      nombre: r.solicitud.nombre,
      email: r.credenciales.email,
      password: r.credenciales.password,
      urlIngreso: urlIngreso(request),
    });
    return NextResponse.json({
      credenciales: r.credenciales,
      mensaje,
      emailConfigurado: emailConfigurado(),
    });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (getRol(user) !== "administrador") {
    return NextResponse.json(
      { error: "Solo un administrador puede reenviar accesos" },
      { status: 403 }
    );
  }

  const admin = createAdminSupabase();
  const { data: sol, error: solErr } = await admin
    .from("solicitudes_acceso")
    .select("id, nombre, email, estado, user_id")
    .eq("id", id)
    .single();
  if (solErr || !sol) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }
  if (sol.estado !== "aprobada" || !sol.user_id) {
    return NextResponse.json(
      { error: "Solo se reenvía el acceso de una solicitud aprobada" },
      { status: 409 }
    );
  }

  // A alguien del equipo no se le cambia la contraseña desde Accesos.
  let rolEquipo;
  try {
    rolEquipo = await rolEquipoDe(admin, sol.user_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
  const bloqueo = bloqueoEnAccesos(rolEquipo, "reenviar");
  if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 });

  // Regenerar la contraseña del usuario cliente (la anterior no se guarda).
  const password = generarPassword(randomCrypto);
  const { error: updErr } = await admin.auth.admin.updateUserById(sol.user_id, {
    password,
  });
  if (updErr) {
    return NextResponse.json(
      { error: `No se pudo regenerar la contraseña: ${updErr.message}` },
      { status: 500 }
    );
  }

  await registrarActividad(admin, actividadReenvio(actorDe(user), sol));

  const mensaje = mensajeCredenciales({
    nombre: sol.nombre,
    email: sol.email,
    password,
    urlIngreso: urlIngreso(request),
  });

  return NextResponse.json({
    credenciales: { email: sol.email, password },
    mensaje,
    emailConfigurado: emailConfigurado(),
  });
}
