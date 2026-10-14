import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol } from "@/lib/auth";
import { ERROR_MONEDA, generateCode, parseMoneda } from "@/lib/operaciones";
import { isMock, mockCreateOp, mockListSolicitudes } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "USD 300", "ARS 150.000": montos legibles para el registro de actividad.
function montoTxt(n: number, moneda: string): string {
  return `${moneda} ${new Intl.NumberFormat("es-AR").format(n)}`;
}

// POST /api/operaciones — crea una operación.
// Solo staff (admin o moderador): una sesión sin rol del panel no carga
// operaciones. La escritura va con service role.
export async function POST(request: Request) {
  // Quién la carga, para el registro de actividad.
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!esStaff(getRol(user))) {
      return NextResponse.json(
        { error: "Solo el equipo puede crear operaciones" },
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

  const evento = String(body.evento ?? "").trim();
  const comprador_alias = body.comprador_alias
    ? String(body.comprador_alias).trim()
    : null;
  const vendedor_alias = body.vendedor_alias
    ? String(body.vendedor_alias).trim()
    : null;
  const monto = Math.trunc(Number(body.monto));
  // Moneda de la operación: pesos o dólares; se guarda, no se convierte.
  const moneda = parseMoneda(body.moneda);
  if (!moneda) return NextResponse.json({ error: ERROR_MONEDA }, { status: 400 });
  const fee = Math.trunc(Number(body.fee));
  const ticket_id = body.ticket_id ? String(body.ticket_id) : null;
  const fecha_evento = body.fecha_evento ? String(body.fecha_evento) : null;
  const notas = body.notas ? String(body.notas).trim().slice(0, 2000) : null;
  const cuenta_debitar = body.cuenta_debitar
    ? String(body.cuenta_debitar).trim().slice(0, 200)
    : null;

  if (fecha_evento && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_evento)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  // Datos mínimos de una operación de custodia: qué se opera, entre quiénes y
  // por cuánto. Se validan también acá (además del form) para que nunca entre
  // una operación con datos vacíos a la base.
  if (!evento) {
    return NextResponse.json(
      { error: "El evento es obligatorio" },
      { status: 400 }
    );
  }
  if (!comprador_alias) {
    return NextResponse.json(
      { error: "El comprador es obligatorio" },
      { status: 400 }
    );
  }
  if (!vendedor_alias) {
    return NextResponse.json(
      { error: "El vendedor es obligatorio" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json(
      { error: "El monto debe ser mayor a 0" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(fee) || fee < 0) {
    return NextResponse.json({ error: "Comisión inválida" }, { status: 400 });
  }

  // Comprador elegido de la lista de clientes: la operación queda vinculada a
  // su cuenta y la ve en Mis pedidos. Se valida acá que sea un cliente
  // aprobado y vigente — un id cualquiera le mostraría la operación a otro.
  const clienteIdRaw = body.cliente_id ? String(body.cliente_id) : null;
  if (clienteIdRaw && !UUID.test(clienteIdRaw)) {
    return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  }
  let cliente: { id: string; email: string | null } | null = null;

  // Registro de actividad, una vez creada (sin el cuerpo del request entero).
  const actividadAlta = (id: string, code: string) => ({
    actor,
    accion: "operacion.crear",
    entidad: "operacion",
    entidad_id: id,
    codigo: code,
    resumen:
      `Creó la operación «${evento}» por ${montoTxt(monto, moneda)} + comisión ${montoTxt(fee, moneda)}` +
      ` · comprador ${comprador_alias}, vendedor ${vendedor_alias}` +
      (cliente?.email ? ` · cuenta de ${cliente.email}` : ""),
    detalle: {
      evento,
      comprador_alias,
      vendedor_alias,
      monto,
      moneda,
      fee,
      ticket_id,
      fecha_evento,
      notas,
      cuenta_debitar,
      cliente_id: cliente?.id ?? null,
      cliente_email: cliente?.email ?? null,
    },
    origen: "panel" as const,
  });

  if (isMock()) {
    if (clienteIdRaw) {
      const s = mockListSolicitudes().find(
        (x) => x.user_id === clienteIdRaw && x.estado === "aprobada" && !x.revocada_at
      );
      if (!s) return NextResponse.json({ error: "Ese cliente no tiene una cuenta activa" }, { status: 400 });
      cliente = { id: clienteIdRaw, email: s.email ?? null };
    }
    const op = mockCreateOp({
      evento, comprador_alias, vendedor_alias, monto, moneda, fee, ticket_id, fecha_evento, notas, cuenta_debitar,
      cliente_id: cliente?.id ?? null,
      cliente_email: cliente?.email ?? null,
    });
    await registrarActividad(null, actividadAlta(op.id, op.code));
    return NextResponse.json(
      { id: op.id, code: op.code, cliente_id: op.cliente_id, cliente_email: op.cliente_email },
      { status: 201 }
    );
  }

  const admin = createAdminSupabase();

  if (clienteIdRaw) {
    const { data: s } = await admin
      .from("solicitudes_acceso")
      .select("user_id, email")
      .eq("user_id", clienteIdRaw)
      .eq("estado", "aprobada")
      .is("revocada_at", null)
      .limit(1)
      .maybeSingle();
    if (!s) return NextResponse.json({ error: "Ese cliente no tiene una cuenta activa" }, { status: 400 });
    cliente = { id: clienteIdRaw, email: (s as { email: string | null }).email ?? null };
  }

  // Reintentos por si el code colisiona (muy improbable).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data, error } = await admin
      .from("operaciones")
      .insert({
        code,
        evento,
        comprador_alias,
        vendedor_alias,
        monto,
        moneda,
        fee,
        ticket_id,
        fecha_evento,
        notas,
        cuenta_debitar,
        cliente_id: cliente?.id ?? null,
        cliente_email: cliente?.email ?? null,
      })
      .select("id, code")
      .single();

    if (!error && data) {
      await registrarActividad(admin, actividadAlta(data.id, data.code));
      return NextResponse.json(
        { id: data.id, code: data.code, cliente_id: cliente?.id ?? null, cliente_email: cliente?.email ?? null },
        { status: 201 }
      );
    }

    // 23505 = unique_violation (colisión de code). Reintentar.
    if (error && (error as any).code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "No se pudo generar un code único, reintentá" },
    { status: 500 }
  );
}
