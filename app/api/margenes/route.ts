import { NextResponse } from "next/server";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import {
  isMock,
  mockListMargenes,
  mockUpsertMargen,
  mockDeleteMargen,
} from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// Márgenes de precio por proveedor + evento/competición (hoy: portal).
// GET    -> reglas vigentes + competiciones existentes en el catálogo.
// PUT    -> crea/edita una regla { competicion|null, porcentaje } y recalcula
//           los precios ya publicados.
// DELETE -> borra una regla por competición (el margen general no se borra).
// Solo administrador; escrituras con service role.

async function requireAdmin(): Promise<{ denied: NextResponse | null; actor: Actor | null }> {
  if (isMock()) return { denied: null, actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { denied: NextResponse.json({ error: "No autorizado" }, { status: 401 }), actor: null };
  }
  if (getRol(user) !== "administrador") {
    return {
      denied: NextResponse.json(
        { error: "Solo el administrador maneja los márgenes" },
        { status: 403 }
      ),
      actor: null,
    };
  }
  return { denied: null, actor: actorDe(user) };
}

export async function GET() {
  const { denied } = await requireAdmin();
  if (denied) return denied;

  if (isMock()) {
    return NextResponse.json({
      margenes: mockListMargenes(),
      competiciones: [
        "World Cup 2026 Canada / Mexico / USA",
        "Spanish Primera Division",
        "English Premier League",
        "Euro 2028",
      ],
    });
  }

  const admin = createAdminSupabase();
  const [margenes, cats] = await Promise.all([
    admin
      .from("margenes")
      .select("id, source, competicion, porcentaje")
      .order("competicion", { ascending: true, nullsFirst: true }),
    // DISTINCT en la base: bajar una fila por ticket chocaba con el tope de
    // 1000 de PostgREST y "Elegir evento" mostraba la mitad de las
    // competiciones.
    admin.rpc("competiciones_catalogo", { p_solo_portal: true }),
  ]);
  if (margenes.error) {
    return NextResponse.json({ error: margenes.error.message }, { status: 500 });
  }
  const competiciones = (cats.data ?? []) as string[];
  return NextResponse.json({ margenes: margenes.data, competiciones });
}

function parsePorcentaje(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 500) return null;
  return Math.round(n * 100) / 100;
}

export async function PUT(request: Request) {
  const { denied, actor } = await requireAdmin();
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const competicion = body.competicion ? String(body.competicion).trim().slice(0, 200) : null;
  const porcentaje = parsePorcentaje(body.porcentaje);
  if (porcentaje == null) {
    return NextResponse.json(
      { error: "Porcentaje inválido (0 a 500)" },
      { status: 400 }
    );
  }

  if (isMock()) {
    const antes = mockListMargenes().find((m) => m.competicion === competicion)?.porcentaje ?? null;
    const margen = mockUpsertMargen(competicion, porcentaje);
    refrescarTienda(); // flujo local completo
    await registrarActividad(null, actividadMargen(actor, margen.id, competicion, antes, porcentaje, 370));
    return NextResponse.json({ margen, recalculadas: 370 });
  }

  const admin = createAdminSupabase();
  // Upsert manual (la unicidad es por índice de expresión, onConflict no aplica).
  // El porcentaje anterior es para el registro de actividad.
  const buscar = admin.from("margenes").select("id, porcentaje").eq("source", "portal");
  const { data: existente } = await (competicion === null
    ? buscar.is("competicion", null)
    : buscar.eq("competicion", competicion)
  ).maybeSingle();

  const write = existente
    ? admin.from("margenes").update({ porcentaje }).eq("id", existente.id).select("*").single()
    : admin
        .from("margenes")
        .insert({ source: "portal", competicion, porcentaje })
        .select("*")
        .single();
  const { data: margen, error } = await write;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Regla específica: repreciá solo esa competición. Margen general (null):
  // todo el catálogo vigente (el RPC ya excluye los eventos pasados).
  const { data: recalculadas, error: rpcErr } = await admin.rpc(
    "recalcular_precios_portal",
    { p_competicion: competicion }
  );
  if (rpcErr) {
    return NextResponse.json(
      { error: `Margen guardado pero falló el recálculo: ${rpcErr.message}` },
      { status: 500 }
    );
  }

  // La tienda es ISR: sin esto los precios viejos siguen hasta la revalidación
  // de fondo. "layout" porque revalidatePath("/") a secas no invalida la
  // página raíz (quirk de Next 14 con route groups).
  refrescarTienda();

  await registrarActividad(
    admin,
    actividadMargen(
      actor,
      String(margen.id),
      competicion,
      existente ? Number(existente.porcentaje) : null,
      porcentaje,
      recalculadas
    )
  );

  return NextResponse.json({ margen, recalculadas });
}

export async function DELETE(request: Request) {
  const { denied, actor } = await requireAdmin();
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const competicion = body.competicion ? String(body.competicion).trim() : null;
  if (competicion === null) {
    return NextResponse.json(
      { error: "El margen general no se borra: editá su porcentaje" },
      { status: 409 }
    );
  }

  if (isMock()) {
    const previa = mockListMargenes().find((m) => m.competicion === competicion);
    if (!mockDeleteMargen(competicion)) {
      return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
    }
    refrescarTienda(); // flujo local completo
    await registrarActividad(null, actividadBorrarMargen(actor, previa ?? null, competicion, 370));
    return NextResponse.json({ ok: true, recalculadas: 370 });
  }

  const admin = createAdminSupabase();
  // .select: qué regla se borró (id y porcentaje), para el registro de actividad.
  const { data: borradas, error } = await admin
    .from("margenes")
    .delete()
    .eq("source", "portal")
    .eq("competicion", competicion)
    .select("id, porcentaje");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Al borrar una regla, solo esa competición vuelve al margen general.
  const { data: recalculadas, error: rpcErr } = await admin.rpc(
    "recalcular_precios_portal",
    { p_competicion: competicion }
  );
  if (rpcErr) {
    return NextResponse.json(
      { error: `Regla borrada pero falló el recálculo: ${rpcErr.message}` },
      { status: 500 }
    );
  }
  refrescarTienda();
  // Sin filas borradas no cambió nada: no se registra.
  const borrada = borradas?.[0];
  if (borrada) {
    await registrarActividad(
      admin,
      actividadBorrarMargen(
        actor,
        { id: String(borrada.id), porcentaje: Number(borrada.porcentaje) },
        competicion,
        recalculadas
      )
    );
  }
  return NextResponse.json({ ok: true, recalculadas });
}

const pct = (n: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n)}%`;
const recalculo = (n: unknown) => (typeof n === "number" ? ` · ${n} precios recalculados` : "");

function actividadMargen(
  actor: Actor | null,
  id: string,
  competicion: string | null,
  antes: number | null,
  despues: number,
  recalculadas: unknown
) {
  const regla = competicion ? `el margen de ${competicion}` : "el margen general";
  const resumen =
    antes == null
      ? `Creó ${regla}: ${pct(despues)}`
      : antes === despues
        ? `Guardó ${regla} en ${pct(despues)} (sin cambios)`
        : `Cambió ${regla}: ${pct(antes)} → ${pct(despues)}`;
  return {
    actor,
    accion: "config.margen",
    entidad: "config",
    entidad_id: id,
    codigo: null,
    resumen: resumen + recalculo(recalculadas),
    detalle: { competicion, antes, despues, recalculadas: recalculadas ?? null },
    origen: "panel" as const,
  };
}

function actividadBorrarMargen(
  actor: Actor | null,
  previa: { id: string; porcentaje: number } | null,
  competicion: string,
  recalculadas: unknown
) {
  const cuanto = previa ? ` (${pct(previa.porcentaje)})` : "";
  return {
    actor,
    accion: "config.margen_borrar",
    entidad: "config",
    entidad_id: previa?.id ?? null,
    codigo: null,
    resumen: `Borró el margen de ${competicion}${cuanto}: vuelve al margen general` + recalculo(recalculadas),
    detalle: { competicion, porcentaje: previa?.porcentaje ?? null, recalculadas: recalculadas ?? null },
    origen: "panel" as const,
  };
}
