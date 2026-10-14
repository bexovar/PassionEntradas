import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, nombreDe } from "@/lib/auth";
import { generarPassword, mensajeCredenciales } from "@/lib/acceso";
import { emailConfigurado, enviarEmail } from "@/lib/email";
import { isMock, MOCK_USER, mockDecidirSolicitud } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

// Aleatoriedad de calidad para la contraseña (no Math.random).
function randomCrypto(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

function urlIngreso(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
    : new URL(request.url).origin;
  return `${base}/ingresar`;
}

// Línea del registro de actividad. NUNCA la contraseña ni el mensaje con las
// credenciales: solo a quién se le dio (o negó) el acceso.
function actividadDecision(
  actor: Actor | null,
  sol: { id: string; nombre: string; email: string },
  aprobada: boolean,
  extra: { usuarioId?: string | null; emailEnviado?: boolean } = {}
): NuevaActividad {
  const quien = `${sol.nombre} (${sol.email})`;
  return {
    actor,
    accion: aprobada ? "acceso.aprobar" : "acceso.rechazar",
    entidad: "solicitud",
    entidad_id: sol.id,
    codigo: null,
    resumen: aprobada
      ? `Aprobó el acceso de ${quien}${extra.emailEnviado ? " y le mandó las credenciales por email" : ""}`
      : `Rechazó la solicitud de acceso de ${quien}`,
    detalle: {
      nombre: sol.nombre,
      email: sol.email,
      ...(aprobada ? { usuario_id: extra.usuarioId ?? null } : {}),
      ...(extra.emailEnviado !== undefined ? { email_enviado: extra.emailEnviado } : {}),
    },
    origen: "panel",
  };
}

// POST /api/acceso/[id]/decidir — SOLO administrador. Aprueba o rechaza una
// solicitud de acceso. Al aprobar crea el usuario cliente (Supabase Auth,
// rol 'cliente' en app_metadata) y devuelve las credenciales UNA sola vez
// para que el admin las mande (mensaje para copiar y/o email).
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  let decididaPor = MOCK_USER.email;
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
        { error: "Solo un administrador puede resolver solicitudes" },
        { status: 403 }
      );
    }
    decididaPor = nombreDe(user) ?? user.email ?? "admin";
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const accion = body?.accion;
  if (accion !== "aprobar" && accion !== "rechazar") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  // --- Mock -----------------------------------------------------------------
  if (isMock()) {
    const r = mockDecidirSolicitud(id, accion, decididaPor);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await registrarActividad(
      null,
      actividadDecision(actor, r.solicitud, r.solicitud.estado === "aprobada", { usuarioId: r.solicitud.user_id })
    );
    if (accion === "rechazar" || !r.credenciales) {
      return NextResponse.json({ estado: "rechazada" });
    }
    const mensaje = mensajeCredenciales({
      nombre: r.solicitud.nombre,
      email: r.credenciales.email,
      password: r.credenciales.password,
      urlIngreso: urlIngreso(request),
    });
    return NextResponse.json({
      estado: "aprobada",
      credenciales: r.credenciales,
      mensaje,
      emailConfigurado: emailConfigurado(),
    });
  }

  // --- Real -----------------------------------------------------------------
  const admin = createAdminSupabase();

  const { data: sol, error: solErr } = await admin
    .from("solicitudes_acceso")
    .select("id, nombre, email, telefono, legajo, direccion, estado")
    .eq("id", id)
    .single();
  if (solErr || !sol) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }
  if (sol.estado !== "pendiente") {
    return NextResponse.json({ error: "La solicitud ya fue resuelta" }, { status: 409 });
  }

  const decididaAt = new Date().toISOString();

  if (accion === "rechazar") {
    const { data: rechazadas, error } = await admin
      .from("solicitudes_acceso")
      .update({ estado: "rechazada", decidida_por: decididaPor, decidida_at: decididaAt })
      .eq("id", id)
      .eq("estado", "pendiente")
      // Solo para el registro: si otro admin la resolvió en el medio, no cambió nada.
      .select("id");
    if (error) {
      return NextResponse.json({ error: "No se pudo rechazar la solicitud" }, { status: 500 });
    }
    if (rechazadas?.length) await registrarActividad(admin, actividadDecision(actor, sol, false));
    return NextResponse.json({ estado: "rechazada" });
  }

  // Aprobar: crear el usuario cliente.
  const password = generarPassword(randomCrypto);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: sol.email,
    password,
    email_confirm: true,
    app_metadata: { role: "cliente" },
    // Precarga el perfil con lo que dejó en la solicitud (editable en /cuenta).
    user_metadata: { nombre: sol.nombre, telefono: sol.telefono, legajo: sol.legajo, direccion: sol.direccion },
  });
  if (createErr || !created?.user) {
    // Email ya registrado u otro fallo de Auth: no marcamos aprobada.
    const msg = /already been registered|already exists/i.test(createErr?.message ?? "")
      ? "Ya existe un usuario con ese email"
      : `No se pudo crear el usuario: ${createErr?.message ?? "error desconocido"}`;
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const { error: updErr } = await admin
    .from("solicitudes_acceso")
    .update({
      estado: "aprobada",
      user_id: created.user.id,
      decidida_por: decididaPor,
      decidida_at: decididaAt,
    })
    .eq("id", id)
    .eq("estado", "pendiente");
  if (updErr) {
    // El usuario quedó creado; avisamos para no perder el rastro.
    return NextResponse.json(
      {
        error:
          "El usuario se creó pero no se pudo actualizar la solicitud. Revisá la cola antes de reintentar.",
      },
      { status: 500 }
    );
  }

  const mensaje = mensajeCredenciales({
    nombre: sol.nombre,
    email: sol.email,
    password,
    urlIngreso: urlIngreso(request),
  });

  // Aviso automático al agente con sus credenciales. Best-effort a propósito:
  // el acceso YA está creado, así que un fallo del proveedor de email no puede
  // tumbar la aprobación ni hacer que el admin la reintente (crearía un 409 por
  // email duplicado). Si falla, el panel conserva el botón para reenviarlo a
  // mano y el mensaje para copiar.
  let emailEnviado = false;
  if (emailConfigurado()) {
    const envio = await enviarEmail({
      to: sol.email,
      subject: "Tu acceso a TicketMirror",
      text: mensaje,
    });
    emailEnviado = envio.ok;
  }

  await registrarActividad(
    admin,
    actividadDecision(actor, sol, true, { usuarioId: created.user.id, emailEnviado })
  );

  return NextResponse.json({
    estado: "aprobada",
    credenciales: { email: sol.email, password },
    mensaje,
    emailConfigurado: emailConfigurado(),
    emailEnviado,
  });
}
