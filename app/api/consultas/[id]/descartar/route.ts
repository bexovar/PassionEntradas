import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol, nombreDe } from "@/lib/auth";
import { isMock, MOCK_USER, mockDescartarConsulta, mockListConsultas } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/consultas/[id]/descartar — staff. Cierra una consulta sin precio
// (no hay entrada, el cliente ya no la quiere, etc.). El cliente la ve como
// "No disponible" en Mis pedidos. No se borra: queda el rastro.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  let quien = MOCK_USER.email;

  if (isMock()) {
    const r = mockDescartarConsulta(params.id, quien);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const c = mockListConsultas().find((x) => x.id === params.id) ?? null;
    await registrarActividad(null, actividadDescartar(params.id, c, actorDemo()));
    return NextResponse.json({ ok: true });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !esStaff(getRol(user))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  quien = nombreDe(user) ?? user.email ?? "staff";

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("consultas")
    .update({ estado: "descartada", resuelta_por: quien, resuelta_at: new Date().toISOString() })
    .eq("id", params.id)
    .in("estado", ["pendiente", "cotizada"])
    // Código, evento y cliente: para el registro de actividad.
    .select("id, code, evento, sector, cantidad, cliente_email, comprador_alias, cotizacion_monto, moneda, cotizacion_version")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    const { data: existe } = await admin.from("consultas").select("id").eq("id", params.id).maybeSingle();
    return existe
      ? NextResponse.json({ error: "Esta consulta ya fue resuelta" }, { status: 409 })
      : NextResponse.json({ error: "Consulta no encontrada" }, { status: 404 });
  }
  await registrarActividad(admin, actividadDescartar(params.id, data, actorDe(user)));
  return NextResponse.json({ ok: true });
}

type ConsultaDescartada = {
  code?: string | null;
  evento?: string | null;
  sector?: string | null;
  cantidad?: number | null;
  cliente_email?: string | null;
  comprador_alias?: string | null;
  cotizacion_monto?: number | null;
  moneda?: string | null;
  cotizacion_version?: number | null;
};

// "Descartó la consulta de juan@x.com: Boca vs River · Platea (2 entradas)".
// Si ya estaba cotizada, también el precio que se le había pasado.
function actividadDescartar(consultaId: string, c: ConsultaDescartada | null, actor: Actor | null) {
  const cliente = c?.cliente_email || c?.comprador_alias || null;
  const que = [c?.evento, c?.sector].filter(Boolean).join(" · ");
  const cant = c?.cantidad ? ` (${c.cantidad} ${c.cantidad === 1 ? "entrada" : "entradas"})` : "";
  const cotizada = Number(c?.cotizacion_version ?? 0) > 0 && c?.cotizacion_monto != null;
  const precio = cotizada
    ? ` · estaba cotizada en ${c?.moneda ?? "USD"} ${new Intl.NumberFormat("es-AR").format(Number(c?.cotizacion_monto))}`
    : "";
  return {
    actor,
    accion: "consulta.descartar",
    entidad: "consulta",
    entidad_id: consultaId,
    codigo: c?.code ?? null,
    resumen: `Descartó la consulta${cliente ? ` de ${cliente}` : ""}${que ? `: ${que}` : ""}${cant}${precio}`,
    detalle: {
      evento: c?.evento ?? null,
      sector: c?.sector ?? null,
      cantidad: c?.cantidad ?? null,
      cliente_email: c?.cliente_email ?? null,
      ...(cotizada
        ? { cotizacion: { monto: Number(c?.cotizacion_monto), moneda: c?.moneda ?? null, version: c?.cotizacion_version } }
        : {}),
    },
    origen: "panel" as const,
  };
}
