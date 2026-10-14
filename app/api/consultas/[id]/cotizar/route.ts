import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol, nombreDe } from "@/lib/auth";
import { ERROR_MONEDA, parseMoneda, type Moneda } from "@/lib/operaciones";
import { parsePrecio } from "@/lib/precios";
import { VENCE_HORAS_DEFAULT, venceAt } from "@/lib/cotizaciones";
import { isMock, MOCK_USER, mockCotizar, mockListConsultas } from "@/lib/mock-db";
import { avisarCotizacionAlCliente } from "@/lib/avisos-cliente";
import { baseUrlDe } from "@/lib/base-url";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/consultas/[id]/cotizar — staff. Le manda al cliente una
// cotización (costo + comisión, en pesos o dólares). NO crea la operación: el
// pedido nace cuando el cliente la acepta (ver /aceptar).
//
// Sirve también para cambiarla: re-cotizar sube la versión y renueva el
// plazo, así el cliente acepta el precio que está viendo y no uno viejo.
//
// Body: { costo, comision, moneda }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let quien = MOCK_USER.email;
  let esAdmin = true;
  let actor: Actor | null = isMock() ? actorDemo() : null;

  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !esStaff(getRol(user))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    quien = nombreDe(user) ?? user.email ?? "staff";
    esAdmin = getRol(user) === "administrador";
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Costo + comisión: al cliente se le cobra la suma; la comisión queda como fee.
  const precio = parsePrecio(body?.costo, body?.comision);
  if (!precio.ok) return NextResponse.json({ error: precio.error }, { status: 400 });
  const moneda = parseMoneda(body?.moneda);
  if (!moneda) return NextResponse.json({ error: ERROR_MONEDA }, { status: 400 });

  if (isMock()) {
    // mockCotizar pisa la fila en el lugar: la cotización previa, antes.
    const previa = mockListConsultas().find((x) => x.id === params.id);
    const antes = previa ? cotizacionDe(previa) : null;
    const r = mockCotizar(params.id, { monto: precio.total, fee: precio.comision, moneda, quien, esAdmin });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await avisarCotizacionAlCliente(null, r.consulta, baseUrlDe(request));
    await registrarActividad(null, actividadCotizar(r.consulta, antes, precio, esAdmin, actor));
    return NextResponse.json({ ok: true, consulta: r.consulta });
  }

  const admin = createAdminSupabase();
  const [{ data: c }, { data: cfg }] = await Promise.all([
    // Monto/comisión/moneda previos: solo para el registro de actividad.
    admin
      .from("consultas")
      .select("id, estado, cotizacion_version, cotizacion_monto, cotizacion_fee, moneda")
      .eq("id", params.id)
      .maybeSingle(),
    admin.from("config").select("value").eq("key", "cotizacion_vence_horas").maybeSingle(),
  ]);
  if (!c) return NextResponse.json({ error: "Consulta no encontrada" }, { status: 404 });
  if (c.estado !== "pendiente" && c.estado !== "cotizada") {
    return NextResponse.json({ error: "Esta consulta ya fue resuelta" }, { status: 409 });
  }
  const horas = Number(cfg?.value) > 0 ? Number(cfg?.value) : VENCE_HORAS_DEFAULT;
  const ahora = new Date();
  const version = Number(c.cotizacion_version ?? 0);

  // Condicionado a la versión leída: si otro miembro del staff cotizó en el
  // medio (o el cliente ya aceptó), no se pisa.
  const { data, error } = await admin
    .from("consultas")
    .update({
      estado: "cotizada",
      cotizacion_monto: precio.total,
      cotizacion_fee: precio.comision,
      moneda,
      cotizacion_version: version + 1,
      cotizada_at: ahora.toISOString(),
      cotizada_por: quien,
      cotizada_por_admin: esAdmin,
      vence_at: venceAt(ahora, horas),
    })
    .eq("id", params.id)
    .eq("cotizacion_version", version)
    .in("estado", ["pendiente", "cotizada"])
    .select(
      "id, code, envio_id, cliente_id, cliente_email, comprador_alias, ticket_id, evento, sector, fecha_evento, cantidad, moneda, notas, estado, operacion_id, resuelta_por, resuelta_at, created_at, updated_at, cotizacion_monto, cotizacion_fee, cotizacion_version, cotizada_at, cotizada_por, cotizada_por_admin, vence_at"
    )
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "La consulta cambió mientras la cotizabas. Actualizá y probá de nuevo." },
      { status: 409 }
    );
  }
  // Que el cliente se entere y la acepte o la rechace (campana + email).
  await avisarCotizacionAlCliente(admin, data, baseUrlDe(request));
  await registrarActividad(admin, actividadCotizar(data, cotizacionDe(c), precio, esAdmin, actor));
  return NextResponse.json({ ok: true, consulta: data });
}

type Cotizacion = { monto: number; fee: number; moneda: Moneda | null; version: number };

// La cotización vigente de la fila; null si todavía no tenía (primera vez).
function cotizacionDe(c: {
  cotizacion_monto?: number | null;
  cotizacion_fee?: number | null;
  moneda?: Moneda | null;
  cotizacion_version?: number | null;
}): Cotizacion | null {
  if (!Number(c.cotizacion_version) || c.cotizacion_monto == null) return null;
  return {
    monto: Number(c.cotizacion_monto),
    fee: Number(c.cotizacion_fee ?? 0),
    moneda: c.moneda ?? null,
    version: Number(c.cotizacion_version),
  };
}

const montoTxt = (n: number, moneda: string | null) =>
  `${moneda ?? "USD"} ${new Intl.NumberFormat("es-AR").format(n)}`;

// "Cotizó USD 300 + comisión USD 50 (total USD 350)"; re-cotizar dice de
// cuánto a cuánto pasó lo que paga el cliente.
function actividadCotizar(
  consulta: {
    id: string;
    code?: string | null;
    evento?: string | null;
    sector?: string | null;
    cantidad?: number | null;
    moneda?: Moneda | null;
    cotizacion_version?: number | null;
    vence_at?: string | null;
  },
  antes: Cotizacion | null,
  precio: { costo: number; comision: number; total: number },
  esAdmin: boolean,
  actor: Actor | null
) {
  const m = consulta.moneda ?? null;
  const desglose = `${montoTxt(precio.costo, m)} + comisión ${montoTxt(precio.comision, m)}`;
  const resumen = antes
    ? `Re-cotizó: ${montoTxt(antes.monto, antes.moneda)} → ${montoTxt(precio.total, m)} (${desglose})`
    : `Cotizó ${desglose} (total ${montoTxt(precio.total, m)})`;
  return {
    actor,
    accion: "consulta.cotizar",
    entidad: "consulta",
    entidad_id: consulta.id,
    codigo: consulta.code ?? null,
    resumen,
    detalle: {
      evento: consulta.evento ?? null,
      sector: consulta.sector ?? null,
      cantidad: consulta.cantidad ?? null,
      moneda: m,
      costo: precio.costo,
      comision: precio.comision,
      total: precio.total,
      version: consulta.cotizacion_version ?? null,
      vence_at: consulta.vence_at ?? null,
      // Si cotizó un moderador, al aceptarse el pedido entra sin confirmar.
      cotizada_por_admin: esAdmin,
      ...(antes ? { antes } : {}),
    },
    origen: "panel" as const,
  };
}
