import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { parseHoras, VENCE_HORAS_DEFAULT, VENCE_HORAS_MAX, VENCE_HORAS_MIN } from "@/lib/cotizaciones";
import { isMock, mockGetVenceHoras, mockSetVenceHoras } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// GET/PUT /api/ajustes-cotizacion — cuántas horas tiene el cliente para
// aceptar una cotización (config.cotizacion_vence_horas, 48 por defecto).
// Aplica a las cotizaciones que se manden DESPUÉS de cambiarlo. Solo admin.
export const dynamic = "force-dynamic";

async function soloAdmin(): Promise<{ no: NextResponse | null; actor: Actor | null }> {
  if (isMock()) return { no: null, actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || getRol(user) !== "administrador") {
    return { no: NextResponse.json({ error: "Solo el administrador" }, { status: 403 }), actor: null };
  }
  return { no: null, actor: actorDe(user) };
}

export async function GET() {
  const { no } = await soloAdmin();
  if (no) return no;
  if (isMock()) return NextResponse.json({ horas: mockGetVenceHoras() });
  const { data } = await createAdminSupabase()
    .from("config")
    .select("value")
    .eq("key", "cotizacion_vence_horas")
    .maybeSingle();
  const h = Number(data?.value);
  return NextResponse.json({ horas: h > 0 ? h : VENCE_HORAS_DEFAULT });
}

export async function PUT(request: Request) {
  const { no, actor } = await soloAdmin();
  if (no) return no;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const horas = parseHoras(body?.horas);
  if (horas == null) {
    return NextResponse.json(
      { error: `Horas inválidas: un número entero entre ${VENCE_HORAS_MIN} y ${VENCE_HORAS_MAX}` },
      { status: 400 }
    );
  }
  if (isMock()) {
    const antes = mockGetVenceHoras();
    mockSetVenceHoras(horas);
    await registrarActividad(null, actividadHoras(actor, antes, horas));
    return NextResponse.json({ horas });
  }
  const admin = createAdminSupabase();
  // El valor anterior, solo para el registro de actividad (sin fila = el
  // default, igual que el GET; si no se pudo leer, queda sin "antes").
  const { data: previo, error: errPrevio } = await admin
    .from("config")
    .select("value")
    .eq("key", "cotizacion_vence_horas")
    .maybeSingle();
  const { error } = await admin
    .from("config")
    .upsert({ key: "cotizacion_vence_horas", value: horas }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const h = Number(previo?.value);
  await registrarActividad(
    admin,
    actividadHoras(actor, errPrevio ? null : h > 0 ? h : VENCE_HORAS_DEFAULT, horas)
  );
  return NextResponse.json({ horas });
}

function actividadHoras(actor: Actor | null, antes: number | null, horas: number) {
  const resumen =
    antes == null
      ? `Fijó el vencimiento de las cotizaciones en ${horas} h`
      : antes === horas
        ? `Guardó el vencimiento de las cotizaciones en ${horas} h (sin cambios)`
        : `Cambió el vencimiento de las cotizaciones: ${antes} h → ${horas} h`;
  return {
    actor,
    accion: "config.ajustes_cotizacion",
    entidad: "config",
    entidad_id: "cotizacion_vence_horas",
    codigo: null,
    resumen,
    detalle: { key: "cotizacion_vence_horas", antes, despues: horas },
    origen: "panel" as const,
  };
}
