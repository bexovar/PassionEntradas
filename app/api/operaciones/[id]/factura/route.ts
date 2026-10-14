import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, nombreDe } from "@/lib/auth";
import {
  metodoValido,
  numeroFactura,
  parseCotizacion,
  type FacturaDatos,
  type FacturaIdioma,
} from "@/lib/factura";
import {
  isMock,
  MOCK_USER,
  mockListItems,
  mockFacturaDeOperacion,
  mockGuardarFactura,
  mockListOps,
  mockListManual,
} from "@/lib/mock-db";
import { MOCK_TICKETS } from "@/lib/mock-tickets";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// Factura/recibo de una operación cobrada.
// GET  -> la factura existente de la operación (404 si no se emitió).
// POST -> emite (o re-emite) la factura: snapshot inmutable con numero
//         correlativo. Re-emitir actualiza los datos pero conserva numero,
//         id (o sea el link) y fecha de emisión original.
// Solo administrador; escrituras con service role.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(): Promise<
  { denied: NextResponse } | { denied: null; quien: string | null; actor: Actor | null }
> {
  if (isMock()) return { denied: null, quien: MOCK_USER.email, actor: actorDemo() };
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || getRol(user) !== "administrador") {
    return {
      denied: NextResponse.json({ error: "No autorizado" }, { status: 401 }),
    };
  }
  return { denied: null, quien: nombreDe(user), actor: actorDe(user) };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (auth.denied) return auth.denied;
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
  }

  if (isMock()) {
    const f = mockFacturaDeOperacion(params.id);
    if (!f) return NextResponse.json({ error: "Sin factura" }, { status: 404 });
    return NextResponse.json(f);
  }

  const { data, error } = await createAdminSupabase()
    .from("facturas")
    .select("id, numero, datos, created_at")
    .eq("operacion_id", params.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Sin factura" }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (auth.denied) return auth.denied;
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = String(body.comprador_nombre ?? "").trim().slice(0, 120);
  const contacto = String(body.comprador_contacto ?? "").trim().slice(0, 160) || null;
  const cantidad = Math.trunc(Number(body.cantidad));
  const metodo = String(body.metodo_pago ?? "").trim().slice(0, 80);
  const idioma: FacturaIdioma = body.idioma === "es" ? "es" : "en";
  // Dólar del día: lo carga el admin a mano en cada emisión de una factura en
  // DÓLARES (deja asentado su valor en pesos ese día). Una factura en pesos no
  // lo necesita. La fecha es la de emisión, en hora argentina.
  const arsPorUsd = parseCotizacion(body.cotizacion);

  if (!nombre) {
    return NextResponse.json(
      { error: "El nombre del comprador es obligatorio" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 100) {
    return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
  }
  if (!metodo) {
    return NextResponse.json(
      { error: "El método de pago es obligatorio" },
      { status: 400 }
    );
  }
  const hoyAr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  // Operación + entrada vinculada (para sede/competición/sector).
  type OpFactura = {
    id: string;
    code: string;
    evento: string;
    monto: number;
    fee: number;
    status: string;
    pago_confirmado_at: string | null;
    fecha_evento: string | null;
    ticket_id: string | null;
    moneda?: "ARS" | "USD" | null;
    // Quién la pidió desde la tienda (null en las cargadas a mano).
    cliente_id?: string | null;
    cliente_email?: string | null;
  };
  let op: OpFactura | null = null;
  let ticket: { competicion: string | null; ciudad: string | null; categoria: string | null } | null =
    null;

  if (isMock()) {
    const m = mockListOps().find((o) => o.id === params.id);
    if (m) {
      op = m;
      const t =
        [...MOCK_TICKETS, ...mockListManual()].find((x) => x.id === m.ticket_id) ?? null;
      if (t) ticket = { competicion: t.competicion, ciudad: t.ciudad, categoria: t.categoria };
    }
  } else {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("operaciones")
      .select("id, code, evento, monto, fee, moneda, status, pago_confirmado_at, fecha_evento, ticket_id, cliente_id, cliente_email")
      .eq("id", params.id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    op = (data ?? null) as OpFactura | null;
    if (op?.ticket_id) {
      const { data: t } = await admin
        .from("tickets")
        .select("competicion, ciudad, categoria")
        .eq("id", op.ticket_id)
        .maybeSingle();
      ticket = t ?? null;
    }
  }

  if (!op) {
    return NextResponse.json({ error: "Operación no encontrada" }, { status: 404 });
  }
  if (op.status === "cancelada") {
    return NextResponse.json(
      { error: "La operación está cancelada: no se factura" },
      { status: 409 }
    );
  }
  const monedaOp = op.moneda ?? "USD";
  if (!metodoValido(metodo, monedaOp)) {
    return NextResponse.json(
      { error: `El método de pago tiene que ser en la moneda de la operación (${monedaOp})` },
      { status: 400 }
    );
  }
  if (monedaOp === "USD" && arsPorUsd == null) {
    return NextResponse.json(
      { error: "Cargá el dólar del día (pesos por dólar), por ejemplo 1465,50" },
      { status: 400 }
    );
  }
  // El invoice es un recibo: recién existe cuando el pago está confirmado.
  if (!op.pago_confirmado_at) {
    return NextResponse.json(
      { error: "El pago todavía no está confirmado: no hay nada que facturar" },
      { status: 409 }
    );
  }

  // Trazabilidad: si la operación nació de un pedido de la tienda, el email y
  // el legajo se toman de la CUENTA del cliente, no de lo que tipeó el admin.
  // Lo tipeado queda como respaldo para las operaciones cargadas a mano.
  let compradorEmail: string | null = op.cliente_email ?? null;
  let compradorLegajo: string | null = null;
  let compradorNombre = nombre;
  if (isMock()) {
    // En demo no hay Supabase Auth: el perfil del cliente sale del mock, para
    // que la cadena de trazabilidad se vea igual que en producción.
    if (op.cliente_id) compradorLegajo = MOCK_USER.legajo;
  } else if (op.cliente_id) {
    const { data: u } = await createAdminSupabase().auth.admin.getUserById(op.cliente_id);
    const meta = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const de = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).trim() : "");
    compradorEmail = u?.user?.email ?? compradorEmail;
    compradorLegajo = de("legajo") || null;
    // El nombre de la cuenta manda; si está vacío se respeta lo tipeado.
    compradorNombre = de("nombre") || nombre;
  }

  // Líneas de la operación. Si no tiene (operación vieja, anterior al modelo
  // multi-línea), se arma una sola con el resumen para que la factura salga
  // igual que antes.
  let lineas: NonNullable<FacturaDatos["items"]> = [];
  if (isMock()) {
    lineas = mockListItems(op.id).map((i) => ({
      evento: i.evento,
      sector: i.sector,
      fecha: i.fecha_evento,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: Math.round(i.cantidad * i.precio_unitario * 100) / 100,
    }));
  } else {
    const { data: filas } = await createAdminSupabase()
      .from("operacion_items")
      .select("evento, sector, fecha_evento, cantidad, precio_unitario")
      .eq("operacion_id", op.id)
      .order("created_at", { ascending: true });
    lineas = (filas ?? []).map((i: any) => ({
      evento: i.evento,
      sector: i.sector ?? null,
      fecha: i.fecha_evento ?? null,
      cantidad: Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
      subtotal: Math.round(Number(i.cantidad) * Number(i.precio_unitario) * 100) / 100,
    }));
  }
  if (lineas.length === 0) {
    lineas = [
      {
        evento: op.evento,
        sector: ticket?.categoria ?? null,
        fecha: op.fecha_evento,
        cantidad,
        precio_unitario: Math.round((op.monto / cantidad) * 100) / 100,
        subtotal: op.monto,
      },
    ];
  }

  const datos: FacturaDatos = {
    idioma,
    comprador: {
      nombre: compradorNombre,
      contacto,
      email: compradorEmail,
      legajo: compradorLegajo,
    },
    agente: auth.quien,
    operacion: { id: op.id, code: op.code },
    evento: {
      titulo: op.evento,
      competicion: ticket?.competicion ?? null,
      fecha: op.fecha_evento,
      sede: ticket?.ciudad ?? null,
      sector: ticket?.categoria ?? null,
    },
    items: lineas,
    cantidad,
    precio_unitario: Math.round((op.monto / cantidad) * 100) / 100,
    subtotal: op.monto,
    // `fee` se guarda como registro interno de la comisión (métricas,
    // contabilidad), pero NO se le suma al total ni se le muestra al cliente:
    // el precio de la entrada ya viene con el markup adentro. Antes se
    // desglosaba como "servicio y custodia" y se cobraba encima, que es
    // cobrarle la comisión dos veces bajo el modelo costo + comisión.
    fee: op.fee,
    total: op.monto,
    metodo_pago: metodo,
    pago_confirmado_at: op.pago_confirmado_at,
    cotizacion: monedaOp === "USD" && arsPorUsd != null ? { ars_por_usd: arsPorUsd, fecha: hoyAr } : null,
    moneda: monedaOp,
  };

  // Registro de actividad, una vez guardada la factura.
  const actividadFactura = (f: { id: string; numero: number; created_at: string }, reemitida: boolean) => ({
    actor: auth.actor,
    accion: "operacion.factura",
    entidad: "operacion",
    entidad_id: datos.operacion.id,
    codigo: datos.operacion.code,
    resumen:
      `${reemitida ? "Re-emitió" : "Emitió"} la factura ${numeroFactura(f.numero, f.created_at)}` +
      ` por ${monedaOp} ${new Intl.NumberFormat("es-AR").format(datos.total)} · ${metodo}` +
      (datos.cotizacion ? ` · dólar del día ARS ${new Intl.NumberFormat("es-AR").format(datos.cotizacion.ars_por_usd)}` : ""),
    detalle: {
      factura_id: f.id,
      numero: f.numero,
      reemitida,
      total: datos.total,
      moneda: monedaOp,
      metodo_pago: metodo,
      idioma,
      cotizacion: datos.cotizacion ?? null,
      comprador: { nombre: compradorNombre, email: compradorEmail },
    },
    origen: "panel" as const,
  });

  if (isMock()) {
    const yaEmitida = !!mockFacturaDeOperacion(params.id);
    const f = mockGuardarFactura(params.id, datos);
    await registrarActividad(null, actividadFactura(f, yaEmitida));
    return NextResponse.json(f, { status: 201 });
  }

  // Upsert por operación: re-emitir actualiza el snapshot pero conserva el
  // numero correlativo y el id (el link ya compartido sigue valiendo).
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("facturas")
    .upsert({ operacion_id: params.id, datos }, { onConflict: "operacion_id" })
    .select("id, numero, datos, created_at, updated_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // updated_at solo sirve para saber si fue una re-emisión (el upsert
  // conserva created_at); la respuesta sigue siendo la de siempre.
  const { updated_at, ...factura } = data as {
    id: string;
    numero: number;
    datos: FacturaDatos;
    created_at: string;
    updated_at: string;
  };
  await registrarActividad(admin, actividadFactura(factura, updated_at !== factura.created_at));
  return NextResponse.json(factura, { status: 201 });
}
