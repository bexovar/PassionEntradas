import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { isMock, mockListOps, mockUpdateOp } from "@/lib/mock-db";
import { formatFecha } from "@/lib/operaciones";
import { actorDe, actorDemo, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

// PATCH /api/operaciones/[id] — edita datos internos de la operación
// (notas del panel y fecha del evento). Solo admin; service role.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Quién edita, para el registro de actividad.
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
        { error: "Solo el administrador puede editar la operación" },
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

  const patch: Record<string, string | null> = {};

  if ("notas" in body) {
    const notas = body.notas == null ? null : String(body.notas).trim().slice(0, 2000);
    patch.notas = notas || null;
  }
  if ("fecha_evento" in body) {
    const fecha = body.fecha_evento ? String(body.fecha_evento) : null;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }
    patch.fecha_evento = fecha;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  if (isMock()) {
    // Valores previos para el registro (mockUpdateOp cambia la fila en el lugar).
    const previa = mockListOps().find((o) => o.id === params.id);
    const antes = previa ? { code: previa.code, notas: previa.notas, fecha_evento: previa.fecha_evento } : null;
    const res = mockUpdateOp(params.id, patch);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    const registro = actividadEdicion(params.id, antes, patch, actor);
    if (registro) await registrarActividad(null, registro);
    return NextResponse.json({
      id: res.op.id,
      notas: res.op.notas,
      fecha_evento: res.op.fecha_evento,
    });
  }

  const admin = createAdminSupabase();
  // Valores previos, solo para el registro de actividad: si la lectura falla
  // se registra igual, sin el "antes".
  const { data: antes } = await admin
    .from("operaciones")
    .select("code, notas, fecha_evento")
    .eq("id", params.id)
    .maybeSingle();
  const { data, error } = await admin
    .from("operaciones")
    .update(patch)
    .eq("id", params.id)
    .select("id, notas, fecha_evento")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Operación no encontrada" },
      { status: 404 }
    );
  }

  const registro = actividadEdicion(params.id, (antes as Previa | null) ?? null, patch, actor);
  if (registro) await registrarActividad(admin, registro);

  return NextResponse.json(data);
}

type Previa = { code: string | null; notas: string | null; fecha_evento: string | null };

// "Editó la operación: fecha del evento 12 ago 2026 → 15 ago 2026, notas".
// El texto de las notas va solo en `detalle` (la línea la ve todo el equipo
// en el historial de la tarjeta, y las notas son internas del admin).
// Sin cambios reales (se guardó lo mismo) no hay nada que registrar.
function actividadEdicion(
  id: string,
  antes: Previa | null,
  patch: Record<string, string | null>,
  actor: Actor | null
): NuevaActividad | null {
  const fecha = (f: string | null) => (f ? formatFecha(f) : "sin fecha");
  const cambios: Record<string, { antes?: string | null; despues: string | null }> = {};
  const partes: string[] = [];
  for (const campo of ["fecha_evento", "notas"] as const) {
    if (!(campo in patch)) continue;
    const previo = antes ? antes[campo] ?? null : null;
    const nuevo = patch[campo] ?? null;
    if (antes && previo === nuevo) continue;
    cambios[campo] = antes ? { antes: previo, despues: nuevo } : { despues: nuevo };
    if (campo === "fecha_evento") {
      partes.push(antes ? `fecha del evento ${fecha(previo)} → ${fecha(nuevo)}` : `fecha del evento → ${fecha(nuevo)}`);
    } else {
      partes.push(!nuevo ? "notas (borradas)" : antes && !previo ? "notas (nuevas)" : "notas");
    }
  }
  if (partes.length === 0) return null;
  return {
    actor,
    accion: "operacion.editar",
    entidad: "operacion",
    entidad_id: id,
    codigo: antes?.code ?? null,
    resumen: `Editó la operación: ${partes.join(", ")}`,
    detalle: { cambios, ...(antes ? {} : { sin_antes: true }) },
    origen: "panel",
  };
}
