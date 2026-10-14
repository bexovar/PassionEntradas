import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, nombreDe } from "@/lib/auth";
import { isMock, MOCK_USER, mockRevocarSolicitud } from "@/lib/mock-db";
import { bloqueoEnAccesos, rolEquipoDe } from "@/lib/equipo";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

// Línea del registro de actividad: a quién se le quitó o devolvió el acceso.
function actividadRevocar(
  actor: Actor | null,
  sol: { id: string; nombre: string; email: string; user_id: string | null },
  revocar: boolean
): NuevaActividad {
  const quien = `${sol.nombre} (${sol.email})`;
  return {
    actor,
    accion: revocar ? "acceso.revocar" : "acceso.reactivar",
    entidad: "solicitud",
    entidad_id: sol.id,
    codigo: null,
    resumen: revocar ? `Revocó el acceso de ${quien}` : `Reactivó el acceso de ${quien}`,
    detalle: { nombre: sol.nombre, email: sol.email, usuario_id: sol.user_id },
    origen: "panel",
  };
}

// POST /api/acceso/[id]/revocar — SOLO administrador. Revoca o reactiva el
// acceso de un cliente aprobado. Revocar = quitarle el rol al usuario de Auth
// (getRol pasa a null => sin acceso, el middleware lo saca); reactivar = se lo
// devuelve. Queda registrado quién y cuándo (auditoría).
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  let quien = MOCK_USER.email;
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (getRol(user) !== "administrador") {
      return NextResponse.json(
        { error: "Solo un administrador puede revocar accesos" },
        { status: 403 }
      );
    }
    quien = nombreDe(user) ?? user.email ?? "admin";
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const accion = body?.accion;
  if (accion !== "revocar" && accion !== "reactivar") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  if (isMock()) {
    const r = mockRevocarSolicitud(id, accion, quien);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await registrarActividad(null, actividadRevocar(actor, r.solicitud, accion === "revocar"));
    return NextResponse.json({ ok: true, revocada: accion === "revocar" });
  }

  const admin = createAdminSupabase();
  const { data: sol, error: solErr } = await admin
    .from("solicitudes_acceso")
    .select("id, nombre, email, estado, user_id, revocada_at")
    .eq("id", id)
    .single();
  if (solErr || !sol) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }
  if (sol.estado !== "aprobada" || !sol.user_id) {
    return NextResponse.json(
      { error: "Solo se revoca el acceso de una solicitud aprobada" },
      { status: 409 }
    );
  }

  // Accesos gestiona CLIENTES. Si esta persona hoy es del equipo, revocar le
  // borraría el rol y reactivar la devolvería como cliente.
  let rolEquipo;
  try {
    rolEquipo = await rolEquipoDe(admin, sol.user_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
  const bloqueo = bloqueoEnAccesos(rolEquipo, accion);
  if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 });

  const revocar = accion === "revocar";
  if (revocar && sol.revocada_at) {
    return NextResponse.json({ error: "El acceso ya está revocado" }, { status: 409 });
  }
  if (!revocar && !sol.revocada_at) {
    return NextResponse.json({ error: "El acceso no está revocado" }, { status: 409 });
  }

  // Quitar/restaurar el rol del usuario de Auth. El merge de app_metadata
  // mantiene el resto de las claves (provider, etc.).
  const { error: authErr } = await admin.auth.admin.updateUserById(sol.user_id, {
    app_metadata: { role: revocar ? null : "cliente" },
  });
  if (authErr) {
    return NextResponse.json(
      { error: `No se pudo ${revocar ? "revocar" : "reactivar"} el acceso: ${authErr.message}` },
      { status: 500 }
    );
  }

  const { error: updErr } = await admin
    .from("solicitudes_acceso")
    .update(
      revocar
        ? { revocada_at: new Date().toISOString(), revocada_por: quien }
        : { revocada_at: null, revocada_por: null }
    )
    .eq("id", id);
  if (updErr) {
    return NextResponse.json(
      { error: "El acceso se cambió pero no se pudo registrar. Revisá la cola." },
      { status: 500 }
    );
  }

  await registrarActividad(admin, actividadRevocar(actor, sol, revocar));

  return NextResponse.json({ ok: true, revocada: revocar });
}
