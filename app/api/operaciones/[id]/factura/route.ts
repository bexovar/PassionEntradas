import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, nombreDe } from "@/lib/auth";
import {
  metodoValido,
  numeroFactura,
  parseCotizacion,
  type CuentaFactura,
  type FacturaDatos,
  type FacturaIdioma,
  type FacturarA,
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
// GET  -> { factura, cuenta }: la factura existente (null si no se emitió) y
//         los datos de la cuenta del cliente que irían en ella (null si la
//         operación no tiene cuenta), para que el modal los muestre antes.
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

// Nombre completo, email y legajo/CUIT de la cuenta que pidió (o a la que se
// le cargó) la operación. Si la cuenta ya no existe queda el email guardado en
// la operación y el resto vacío.
// Los clientes aprobados antes de que se guardara el perfil en la cuenta no
// tienen nombre ni legajo en user_metadata: salen de su solicitud de acceso,
// igual que en Mi cuenta. Así la factura no termina con el email como nombre.
async function cuentaDelCliente(op: {
  cliente_id?: string | null;
  cliente_email?: string | null;
  comprador_alias?: string | null;
}): Promise<CuentaFactura | null> {
  if (!op.cliente_id) return null;
  if (isMock()) {
    // En demo no hay Supabase Auth: el perfil del cliente sale del mock, para
    // que la cadena de trazabilidad se vea igual que en producción.
    // Un alias que es un email es una cuenta sin nombre, como en producción.
    return { nombre: aliasComoNombre(op.comprador_alias), email: op.cliente_email ?? null, legajo: MOCK_USER.legajo };
  }
  const admin = createAdminSupabase();
  const { data: u } = await admin.auth.admin.getUserById(op.cliente_id);
  const meta = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const de = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).trim() : "");
  // Los clientes cargan "nombre y apellido" en un solo campo; las cuentas
  // del equipo los tienen separados. Se arma el completo en los dos casos.
  let nombre = [de("nombre"), de("apellido")].filter(Boolean).join(" ");
  let legajo = de("legajo");
  if (!nombre || !legajo) {
    const { data: sol } = await admin
      .from("solicitudes_acceso")
      .select("nombre, legajo")
      .eq("user_id", op.cliente_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = (sol ?? {}) as { nombre?: string | null; legajo?: string | null };
    nombre = nombre || (s.nombre ?? "").trim();
    legajo = legajo || (s.legajo ?? "").trim();
  }
  return {
    nombre,
    email: u?.user?.email ?? op.cliente_email ?? null,
    legajo: legajo || null,
  };
}

// El alias de un pedido de la tienda es el nombre de la cuenta o, si no tenía,
// su email: como nombre de factura solo sirve el primero.
function aliasComoNombre(alias: string | null | undefined): string {
  const a = (alias ?? "").trim();
  return a.includes("@") ? "" : a;
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
    const op = mockListOps().find((o) => o.id === params.id);
    return NextResponse.json({
      factura: mockFacturaDeOperacion(params.id) ?? null,
      cuenta: op ? await cuentaDelCliente(op) : null,
    });
  }

  const admin = createAdminSupabase();
  const [{ data, error }, { data: op }] = await Promise.all([
    admin.from("facturas").select("id, numero, datos, created_at").eq("operacion_id", params.id).maybeSingle(),
    admin.from("operaciones").select("cliente_id, cliente_email, comprador_alias").eq("id", params.id).maybeSingle(),
  ]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ factura: data ?? null, cuenta: op ? await cuentaDelCliente(op) : null });
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
  // CUIT / Tax ID tipeado: solo cuenta cuando se factura a "otro".
  const legajoTipeado = String(body.comprador_legajo ?? "").trim().slice(0, 40) || null;
  const metodo = String(body.metodo_pago ?? "").trim().slice(0, 80);
  const idioma: FacturaIdioma = body.idioma === "es" ? "es" : "en";
  // Dólar del día: OPCIONAL en una factura en DÓLARES. Si el admin lo carga,
  // la factura deja asentado el total en pesos de ese día; vacío, sale solo
  // en dólares. Una factura en pesos no lo usa. La fecha es la de emisión, en
  // hora argentina.
  const cotizacionVacia = body.cotizacion == null || String(body.cotizacion).trim() === "";
  const arsPorUsd = cotizacionVacia ? null : parseCotizacion(body.cotizacion);

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
    cantidad?: number | null;
    comprador_alias?: string | null;
    // Cuenta del cliente (null en las cargadas a mano sin cliente de la lista).
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
      .select("id, code, evento, monto, fee, moneda, cantidad, comprador_alias, status, pago_confirmado_at, fecha_evento, ticket_id, cliente_id, cliente_email")
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
  // Escrito pero ilegible: mejor rechazar que emitir sin el dato que se quiso
  // poner (o con un typo).
  if (monedaOp === "USD" && !cotizacionVacia && arsPorUsd == null) {
    return NextResponse.json(
      { error: "El dólar del día no es válido (pesos por dólar, por ejemplo 1465,50). Dejalo vacío para no mostrar pesos." },
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

  // A quién se le factura. Con cuenta, por defecto a ella: nombre completo,
  // email y legajo salen de la CUENTA, no de lo que tipeó el admin (el mismo
  // legajo que cargó al pedir acceso llega hasta la factura). "otro" es otra
  // persona o una empresa: nombre o razón social y CUIT tipeados, sin el email
  // de la cuenta. Sin cuenta, siempre es lo tipeado.
  const facturarA: FacturarA = op.cliente_id && body.facturar_a !== "otro" ? "cuenta" : "otro";
  let compradorNombre = nombre;
  let compradorEmail: string | null = null;
  let compradorLegajo: string | null = legajoTipeado;
  if (facturarA === "cuenta") {
    const cuenta = await cuentaDelCliente(op);
    // El nombre de la cuenta manda; si está vacío se respeta lo tipeado.
    compradorNombre = cuenta?.nombre || nombre || aliasComoNombre(op.comprador_alias);
    compradorEmail = cuenta?.email ?? null;
    compradorLegajo = cuenta?.legajo ?? null;
  }
  if (!compradorNombre) {
    return NextResponse.json(
      { error: "El nombre del comprador es obligatorio" },
      { status: 400 }
    );
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
    // La cantidad es la de la operación (se carga al crearla), no un dato
    // que se tipea al facturar: así el unitario siempre cierra con el total.
    const cantOp = Math.max(1, Math.trunc(Number(op.cantidad) || 1));
    lineas = [
      {
        evento: op.evento,
        sector: ticket?.categoria ?? null,
        fecha: op.fecha_evento,
        cantidad: cantOp,
        precio_unitario: Math.round((op.monto / cantOp) * 100) / 100,
        subtotal: op.monto,
      },
    ];
  }
  const cantidad = lineas.reduce((s, l) => s + l.cantidad, 0);

  const datos: FacturaDatos = {
    idioma,
    comprador: {
      nombre: compradorNombre,
      contacto,
      email: compradorEmail,
      legajo: compradorLegajo,
      facturar_a: facturarA,
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
      comprador: { nombre: compradorNombre, email: compradorEmail, legajo: compradorLegajo, facturar_a: facturarA },
      cantidad,
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
