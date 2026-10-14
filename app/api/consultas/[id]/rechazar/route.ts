import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { notificarVendedoresEmail } from "@/lib/email";
import { isMock, MOCK_USER, mockListConsultas, mockRechazarCotizacion } from "@/lib/mock-db";
import { actorDe, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/consultas/[id]/rechazar — el CLIENTE rechaza la cotización que le
// mandaron. Solo la suya y solo si sigue cotizada. Queda como "rechazada".
const CLIENTE_DEMO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (isMock()) {
    const r = mockRechazarCotizacion(params.id, CLIENTE_DEMO);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const c = mockListConsultas().find((x) => x.id === params.id) ?? null;
    await registrarActividad(
      null,
      actividadRechazar(params.id, c, { id: CLIENTE_DEMO, email: MOCK_USER.email, nombre: null, rol: "cliente" })
    );
    return NextResponse.json({ ok: true });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !puedeVerTienda(getRol(user))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("consultas")
    .update({ estado: "rechazada", resuelta_por: "cliente", resuelta_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("cliente_id", user.id)
    .eq("estado", "cotizada")
    // La cotización rechazada: para el registro de actividad.
    .select("code, evento, sector, cantidad, cotizacion_monto, cotizacion_fee, moneda, cotizacion_version")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    const { data: existe } = await admin
      .from("consultas")
      .select("id")
      .eq("id", params.id)
      .eq("cliente_id", user.id)
      .maybeSingle();
    return existe
      ? NextResponse.json({ error: "Esta cotización ya no está disponible" }, { status: 409 })
      : NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
  }
  try {
    await notificarVendedoresEmail(
      `❌ Cotización rechazada — ${data.code}`,
      `El cliente ${user.email ?? user.id} rechazó la cotización de ${data.evento} (${data.code}).`
    );
  } catch (e) {
    console.error("[rechazar] no se pudo avisar a los vendedores:", e);
  }
  await registrarActividad(admin, actividadRechazar(params.id, data, actorDe(user)));
  return NextResponse.json({ ok: true });
}

type ConsultaRechazada = {
  code?: string | null;
  evento?: string | null;
  sector?: string | null;
  cantidad?: number | null;
  cotizacion_monto?: number | null;
  cotizacion_fee?: number | null;
  moneda?: string | null;
  cotizacion_version?: number | null;
};

// "Rechazó la cotización de USD 350 (Boca vs River)".
function actividadRechazar(consultaId: string, c: ConsultaRechazada | null, actor: Actor | null) {
  const monto = c?.cotizacion_monto != null ? Number(c.cotizacion_monto) : null;
  const precio =
    monto != null ? ` de ${c?.moneda ?? "USD"} ${new Intl.NumberFormat("es-AR").format(monto)}` : "";
  return {
    actor,
    accion: "consulta.rechazar",
    entidad: "consulta",
    entidad_id: consultaId,
    codigo: c?.code ?? null,
    resumen: `Rechazó la cotización${precio}${c?.evento ? ` (${c.evento})` : ""}`,
    detalle: {
      evento: c?.evento ?? null,
      sector: c?.sector ?? null,
      cantidad: c?.cantidad ?? null,
      moneda: c?.moneda ?? null,
      monto,
      comision: c?.cotizacion_fee != null ? Number(c.cotizacion_fee) : null,
      version: c?.cotizacion_version ?? null,
    },
    origen: "tienda" as const,
  };
}
