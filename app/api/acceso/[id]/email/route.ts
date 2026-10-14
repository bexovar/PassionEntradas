import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { mensajeCredenciales } from "@/lib/acceso";
import { enviarEmail } from "@/lib/email";
import { isMock, mockListSolicitudes } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

function urlIngreso(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
    : new URL(request.url).origin;
  return `${base}/ingresar`;
}

// POST /api/acceso/[id]/email — SOLO administrador. Envía por email las
// credenciales de una solicitud ya aprobada. La contraseña no se guarda:
// llega en el body (la tiene el panel en memoria desde la aprobación). Es la
// SEGUNDA opción de entrega; la primera (copiar el mensaje) siempre funciona.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (getRol(user) !== "administrador") {
      return NextResponse.json(
        { error: "Solo un administrador puede enviar accesos" },
        { status: 403 }
      );
    }
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const password = String(body?.password ?? "");
  if (!password) {
    return NextResponse.json({ error: "Falta la contraseña" }, { status: 400 });
  }

  // Datos de la solicitud (nombre + email destino).
  let nombre = "";
  let email = "";
  if (isMock()) {
    const sol = mockListSolicitudes().find((s) => s.id === id);
    if (!sol || sol.estado !== "aprobada") {
      return NextResponse.json({ error: "Solicitud no aprobada" }, { status: 409 });
    }
    nombre = sol.nombre;
    email = sol.email;
  } else {
    const { data: sol } = await createAdminSupabase()
      .from("solicitudes_acceso")
      .select("nombre, email, estado")
      .eq("id", id)
      .single();
    if (!sol || sol.estado !== "aprobada") {
      return NextResponse.json({ error: "Solicitud no aprobada" }, { status: 409 });
    }
    nombre = sol.nombre;
    email = sol.email;
  }

  const text = mensajeCredenciales({ nombre, email, password, urlIngreso: urlIngreso(request) });
  const r = await enviarEmail({
    to: email,
    subject: "Tu acceso a TicketMirror",
    text,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, noConfigurado: r.noConfigurado ?? false },
      { status: r.noConfigurado ? 422 : 502 }
    );
  }
  // Registro de actividad: a quién se le mandó el acceso (nunca la contraseña).
  await registrarActividad(isMock() ? null : createAdminSupabase(), {
    actor,
    accion: "acceso.email",
    entidad: "solicitud",
    entidad_id: id,
    codigo: null,
    resumen: `Mandó por email las credenciales de ${nombre} (${email})`,
    detalle: { nombre, email },
    origen: "panel",
  });
  return NextResponse.json({ ok: true });
}
