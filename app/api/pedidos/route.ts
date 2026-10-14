import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda, nombreDe } from "@/lib/auth";
import { formatMonto, generateCode, type TipoOperacion } from "@/lib/operaciones";
import { notificarVendedores, type WhatsappResult } from "@/lib/whatsapp";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { notificarVendedoresEmail } from "@/lib/email";
import {
  isMock,
  mockCreateOp,
  mockCrearConsulta,
  mockListManual,
  MOCK_USER,
} from "@/lib/mock-db";
import { fetchConfigTienda } from "@/lib/supabase/public";
import { DEFAULT_EUR_USD, type MonedaVenta } from "@/lib/tickets";
import {
  evaluarLimite,
  reconciliarItem,
  partirPorStock,
  entradasMovidasPorStock,
  agruparPorMoneda,
  resumenOperacion,
  separarPorTipo,
  detalleDeLineas,
  tipoDelEnvio,
  TIPO_ENVIO_LABEL,
  RL_MAX_VENTANA,
  RL_VENTANA_MS,
  type ItemPedido,
  type TicketRef,
} from "@/lib/pedidos";
import { actorDe, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/pedidos — el cliente hace un PEDIDO o una CONSULTA sobre una
// entrada del catálogo. Se hacen DOS cosas por cada acción:
//   1) se registra en la app como una operación (tipo pedido/consulta,
//      linkeada al cliente y a la entrada) para trackearla desde el panel;
//   2) se avisa a los vendedores por WhatsApp para que la accionen.
// El aviso por WhatsApp es best-effort: si no está configurado o falla, el
// registro igual queda hecho (nunca se pierde un pedido por eso).

type Ctx = { cliente_id: string | null; cliente_email: string | null; comprador: string; actor: Actor | null };

async function contexto(): Promise<Ctx | { error: string; status: number }> {
  if (isMock()) {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    return {
      cliente_id: id,
      cliente_email: MOCK_USER.email,
      comprador: "Demo Cliente",
      // Para el registro de actividad: pide el cliente demo, no el admin demo.
      actor: { id, email: MOCK_USER.email, nombre: null, rol: "cliente" },
    };
  }
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado", status: 401 };
  if (!puedeVerTienda(getRol(user))) {
    return { error: "Tu cuenta no tiene acceso a la tienda", status: 403 };
  }
  return {
    cliente_id: user.id,
    cliente_email: user.email ?? null,
    comprador: nombreDe(user) ?? user.email ?? "Cliente",
    actor: actorDe(user),
  };
}

// "USD 300", "ARS 150.000": montos legibles para el registro de actividad.
function montoTxt(n: number, moneda: string): string {
  return `${moneda} ${new Intl.NumberFormat("es-AR").format(n)}`;
}

// --- Anti-flood --------------------------------------------------------------
// Sin infra nueva: se cuenta sobre `operaciones`, que es donde ya queda el
// rastro. La decisión en sí está en lib/pedidos.ts (evaluarLimite).
async function limiteExcedido(clienteId: string | null): Promise<string | null> {
  // En mock no se aplica: el demo y los e2e envían pedidos seguidos.
  if (isMock() || !clienteId) return null;
  const desde = new Date(Date.now() - RL_VENTANA_MS).toISOString();
  const { data, error } = await createAdminSupabase()
    .from("operaciones")
    .select("created_at")
    .eq("cliente_id", clienteId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(RL_MAX_VENTANA + 1);
  // Ante un error de lectura no se bloquea al cliente (fail-open: perder un
  // pedido legítimo es peor que dejar pasar un envío de más).
  if (error) return null;
  return evaluarLimite(
    (data ?? []).map((r) => String(r.created_at)),
    Date.now()
  );
}

// --- Datos reales de la entrada ----------------------------------------------
// Trae las filas de `tickets` contra las que se reconcilian los items del
// carrito (la reconciliación en sí está en lib/pedidos.ts).
async function buscarTickets(ids: string[]): Promise<Map<string, TicketRef>> {
  const map = new Map<string, TicketRef>();
  if (ids.length === 0) return map;
  const guardar = (t: any) =>
    map.set(t.id, {
      evento: t.evento,
      categoria: t.categoria ?? null,
      precio_final: t.precio_final ?? null,
      stock: t.stock ?? null,
      fecha: t.fecha ?? null,
      source: t.source === "manual" ? "manual" : "portal",
      precio_origen: t.precio_origen ?? null,
      precio_costo: t.precio_costo ?? null,
      moneda_final: t.moneda_final ?? null,
    });

  if (isMock()) {
    const { MOCK_TICKETS } = await import("@/lib/mock-tickets");
    for (const t of [...MOCK_TICKETS, ...mockListManual()]) {
      if (ids.includes(t.id)) guardar(t);
    }
    return map;
  }
  const { data } = await createAdminSupabase()
    .from("tickets")
    .select("id, evento, categoria, precio_final, stock, fecha, source, precio_origen, precio_costo, moneda_final")
    .in("id", ids);
  for (const t of (data ?? []) as any[]) guardar(t);
  return map;
}

export async function POST(request: Request) {
  const ctx = await contexto();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const limite = await limiteExcedido(ctx.cliente_id);
  if (limite) {
    return NextResponse.json({ error: limite }, { status: 429 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // El carrito manda { items: [...] }; se acepta también un item suelto
  // (compat: { tipo, evento, ... }) envolviéndolo en un array.
  const raw = Array.isArray(body.items) ? body.items : [body];
  // Idioma de la tienda al pedir: los avisos por email le llegan en ese. Se
  // guarda siempre que la tienda lo mande (también "es"): sin idioma, los
  // emails usan el de la cuenta, que puede ser otro.
  const idiomaElegido: "es" | "en" | null = body?.lang === "en" || body?.lang === "es" ? body.lang : null;
  const idioma: "es" | "en" = idiomaElegido ?? "es";
  if (raw.length === 0) {
    return NextResponse.json({ error: "El pedido está vacío" }, { status: 400 });
  }
  if (raw.length > 50) {
    return NextResponse.json({ error: "Demasiadas entradas en un pedido" }, { status: 400 });
  }

  // Validación + normalización de cada entrada.
  type Parsed = ItemPedido;
  const parsed: Parsed[] = [];
  for (const it of raw) {
    const tipo = String(it?.tipo ?? "") as TipoOperacion;
    if (tipo !== "pedido" && tipo !== "consulta") {
      return NextResponse.json({ error: "Tipo inválido (pedido o consulta)" }, { status: 400 });
    }
    const evento = String(it?.evento ?? "").trim();
    if (!evento) {
      return NextResponse.json({ error: "Falta el evento en una entrada" }, { status: 400 });
    }
    const sector = it?.sector ? String(it.sector).trim().slice(0, 200) : null;
    const ticket_id = it?.ticket_id ? String(it.ticket_id).slice(0, 200) : null;
    // Cantidad: solo un pedido puede pedir más de una; la consulta es siempre
    // por una. El tope real por stock lo aplica la tienda; acá se acota a un
    // rango sano (1..99) para no guardar valores absurdos.
    const cantRaw = Math.trunc(Number(it?.cantidad));
    const cantidad =
      tipo === "pedido" && Number.isFinite(cantRaw) && cantRaw > 0
        ? Math.min(cantRaw, 99)
        : 1;
    // Precio unitario: redondeo (no truncado) para que coincida con el precio
    // mostrado en la tienda (fmtPrice usa Math.round). `monto` guardado = total
    // de la línea = unitario × cantidad; la factura deriva el unitario de vuelta.
    const unitRaw = Math.round(Number(it?.monto));
    const unit = Number.isFinite(unitRaw) && unitRaw > 0 ? unitRaw : 0;
    const monto = unit * cantidad;
    const fechaRaw = it?.fecha_evento ? String(it.fecha_evento).slice(0, 10) : null;
    const fecha_evento = fechaRaw && /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : null;
    parsed.push({ tipo, evento, sector, ticket_id, monto, cantidad, fecha_evento });
  }

  // Los items vinculados a una entrada del catálogo se reconcilian contra la
  // fila real: evento, sector, fecha y PRECIO salen de la base, no del cliente.
  // Lo que pide más que el stock que queda se parte: lo disponible como
  // pedido y el resto como consulta (ver partirPorStock). Los que no matchean
  // quedan como vinieron.
  const refs = await buscarTickets(
    parsed.map((p) => p.ticket_id).filter((id): id is string => !!id)
  );
  // La tienda muestra TODO en USD: el portal está en EUR y las propias en la
  // moneda con que se cargaron, y se convierten con las cotizaciones del panel.
  // Hay que aplicar la misma conversión acá o el monto guardado no sería el
  // precio que vio el cliente.
  const sinConfig = { eurUsd: DEFAULT_EUR_USD, arsPorUsd: null };
  const tasa = refs.size ? await fetchConfigTienda().catch(() => sinConfig) : sinConfig;

  const pedidoOriginal = [...parsed];
  // Para avisarle al cliente que parte de lo que pidió quedó a consultar por
  // falta de stock (no por otra razón, como no tener precio).
  let aConsultaPorStock = 0;
  // Para el registro de actividad: qué líneas pedidas terminaron en consulta,
  // por qué (sin stock o sin precio) y, si se partió, la parte que siguió como
  // pedido.
  type PasoAConsulta = { pedidas: number; motivo: "sin_stock" | "sin_precio"; enPedido: ItemPedido | null };
  const pasoAConsulta = new Map<ItemPedido, PasoAConsulta>();
  parsed.splice(
    0,
    parsed.length,
    ...pedidoOriginal.flatMap((p) => {
      const ref = p.ticket_id ? refs.get(p.ticket_id) : undefined;
      const partes = partirPorStock(p, ref);
      aConsultaPorStock += entradasMovidasPorStock(p, partes);
      const reconciliadas = partes.map((parte) => reconciliarItem(parte, ref, tasa));
      if (p.tipo === "pedido") {
        const enPedido = reconciliadas.find((r) => r.tipo === "pedido") ?? null;
        reconciliadas.forEach((r, i) => {
          if (r.tipo !== "consulta") return;
          pasoAConsulta.set(r, {
            pedidas: p.cantidad,
            motivo: partes[i].tipo === "consulta" ? "sin_stock" : "sin_precio",
            enPedido,
          });
        });
      }
      return reconciliadas;
    })
  );

  // Comisión de la operación = suma de la de cada línea (precio − costo). Sin
  // esto el tablero mostraba "comisión ganada: 0" para TODO lo que entra por la
  // tienda, que es casi todo: el markup del portal y el de las entradas propias
  // viven dentro del precio y nadie los estaba registrando.
  const comisionDe = (lineas: ItemPedido[]) =>
    lineas.reduce((acc, l) => acc + (l.comision ?? 0), 0);

  const quien = `${ctx.comprador}${ctx.cliente_email ? ` (${ctx.cliente_email})` : ""}`;
  const detalle = (p: Parsed) =>
    `${p.evento}${p.sector ? ` — ${p.sector}` : ""}${p.cantidad > 1 ? ` ×${p.cantidad}` : ""}`;
  const notasDePedido = (ls: Parsed[]) =>
    `Pedido desde la tienda por ${quien}\n` + ls.map((l) => `· ${detalle(l)}`).join("\n");
  const notasDeConsulta = (l: Parsed, _c: Ctx) =>
    `Consulta desde la tienda por ${quien} — ${detalle(l)}`;

  // 1) Registro en la app. UN envío del carrito = UNA operación con sus
  // líneas. Lo que va "a consultar" no tiene precio cerrado, así que no es una
  // operación: va a `consultas` y se convierte después desde el panel. Ambas
  // comparten `envio_id` para no perder que entraron juntas.
  const { pedidos: lineasPedido, consultas: lineasConsulta } = separarPorTipo(parsed);
  const envioId = crypto.randomUUID();

  type Creada = {
    id: string;
    code: string;
    evento: string;
    monto: number;
    cantidad: number;
    moneda: MonedaVenta;
    lineas: ItemPedido[];
  };
  // Una operación por moneda (ver agruparPorMoneda): un carrito con entradas
  // en pesos y en dólares no puede ser una sola deuda.
  const operaciones: Creada[] = [];
  const consultasCreadas: { id: string; code: string; evento: string }[] = [];
  // La línea de cada consulta creada (por id), para el registro de actividad.
  const lineaDeConsulta = new Map<string, ItemPedido>();
  const grupos = agruparPorMoneda(lineasPedido);

  if (isMock()) {
    for (const g of grupos) {
      const resumen = resumenOperacion(g.lineas);
      const op = mockCreateOp({
        evento: resumen.evento,
        comprador_alias: ctx.comprador,
        vendedor_alias: null,
        monto: resumen.monto,
        moneda: g.moneda,
        cantidad: resumen.cantidad,
        fee: comisionDe(g.lineas),
        ticket_id: resumen.ticket_id,
        fecha_evento: resumen.fecha_evento,
        notas: notasDePedido(g.lineas),
        cuenta_debitar: null,
        tipo: "pedido",
        cliente_id: ctx.cliente_id,
        cliente_email: ctx.cliente_email,
        sector: resumen.sector,
        envio_id: envioId,
        idioma,
        items: g.lineas.map((l) => ({
          ticket_id: l.ticket_id,
          evento: l.evento,
          sector: l.sector,
          fecha_evento: l.fecha_evento,
          cantidad: l.cantidad,
          precio_unitario: l.cantidad > 0 ? l.monto / l.cantidad : 0,
        })),
      });
      operaciones.push({
        id: op.id,
        code: op.code,
        evento: op.evento,
        monto: op.monto,
        cantidad: op.cantidad,
        moneda: g.moneda,
        lineas: g.lineas,
      });
    }
    for (const l of lineasConsulta) {
      const c = mockCrearConsulta({
        envio_id: envioId,
        cliente_id: ctx.cliente_id,
        cliente_email: ctx.cliente_email,
        comprador_alias: ctx.comprador,
        ticket_id: l.ticket_id,
        evento: l.evento,
        sector: l.sector,
        fecha_evento: l.fecha_evento,
        cantidad: l.cantidad,
        moneda: l.moneda ?? null,
        notas: notasDeConsulta(l, ctx),
      });
      consultasCreadas.push({ id: c.id, code: c.code, evento: c.evento });
      lineaDeConsulta.set(c.id, l);
    }
  } else {
    const admin = createAdminSupabase();
    // Si falla una operación a mitad de un carrito de dos monedas, se borran
    // las que ya se habían creado: nada a medias en el panel.
    const deshacer = async () => {
      if (operaciones.length) {
        await admin.from("operaciones").delete().in("id", operaciones.map((o) => o.id));
      }
    };

    for (const g of grupos) {
      const resumen = resumenOperacion(g.lineas);
      let creada: Creada | null = null;
      // Reintento por colisión de code (23505); muy improbable.
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await admin
          .from("operaciones")
          .insert({
            code: generateCode(),
            evento: resumen.evento,
            comprador_alias: ctx.comprador,
            monto: resumen.monto,
            // Siempre explícita: la base tenía default 'USD' y una operación
            // en pesos sin moneda quedaba como dólares (el pedido de Boca).
            moneda: g.moneda,
            cantidad: resumen.cantidad,
            fee: comisionDe(g.lineas),
            ticket_id: resumen.ticket_id,
            fecha_evento: resumen.fecha_evento,
            notas: notasDePedido(g.lineas),
            tipo: "pedido",
            cliente_id: ctx.cliente_id,
            cliente_email: ctx.cliente_email,
            sector: resumen.sector,
            envio_id: envioId,
          })
          .select("id, code, evento, monto, cantidad")
          .single();
        if (!error && data) {
          creada = { ...(data as Omit<Creada, "moneda" | "lineas">), moneda: g.moneda, lineas: g.lineas };
          break;
        }
        if (error && (error as any).code !== "23505") {
          await deshacer();
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
      if (!creada) {
        await deshacer();
        return NextResponse.json(
          { error: "No se pudo registrar el pedido, reintentá" },
          { status: 500 }
        );
      }
      operaciones.push(creada);

      // El idioma va aparte y sin chequear: si la columna todavía no existe
      // (migración 0045 sin aplicar) el pedido no se puede caer por eso.
      if (idiomaElegido) {
        await admin.from("operaciones").update({ idioma: idiomaElegido }).eq("id", creada.id);
      }

      // Las líneas. Si fallan, la operación queda sin detalle: se borra para
      // no dejar una operación a medias en el panel.
      const { error: errItems } = await admin.from("operacion_items").insert(
        g.lineas.map((l) => ({
          operacion_id: creada!.id,
          ticket_id: l.ticket_id,
          evento: l.evento,
          sector: l.sector,
          fecha_evento: l.fecha_evento,
          cantidad: l.cantidad,
          precio_unitario: l.cantidad > 0 ? l.monto / l.cantidad : 0,
        }))
      );
      if (errItems) {
        await deshacer();
        return NextResponse.json(
          { error: "No se pudo registrar el detalle del pedido, reintentá" },
          { status: 500 }
        );
      }
    }

    for (const l of lineasConsulta) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await admin
          .from("consultas")
          .insert({
            code: generateCode(),
            envio_id: envioId,
            cliente_id: ctx.cliente_id,
            cliente_email: ctx.cliente_email,
            comprador_alias: ctx.comprador,
            ticket_id: l.ticket_id,
            evento: l.evento,
            sector: l.sector,
            fecha_evento: l.fecha_evento,
            cantidad: l.cantidad,
            // Moneda en que se va a cobrar esa entrada: la cotización arranca
            // en esa moneda (una consulta de una entrada en pesos se cotiza en
            // pesos). null si no está vinculada a una entrada del catálogo.
            moneda: l.moneda ?? null,
            notas: notasDeConsulta(l, ctx),
          })
          .select("id, code, evento")
          .single();
        if (!error && data) {
          consultasCreadas.push(data as { id: string; code: string; evento: string });
          lineaDeConsulta.set((data as { id: string }).id, l);
          // Igual que en la operación: aparte y sin chequear (ver arriba).
          if (idiomaElegido) {
            await admin.from("consultas").update({ idioma: idiomaElegido }).eq("id", (data as { id: string }).id);
          }
          break;
        }
        if (error && (error as any).code !== "23505") {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }
  }

  // Registro de actividad: una línea por cada operación y cada consulta
  // creadas (recién acá, con todo el envío guardado).
  const adminActividad = isMock() ? null : createAdminSupabase();
  const listaTxt = (ls: ItemPedido[]) =>
    ls.slice(0, 3).map((l) => detalle(l)).join(", ") + (ls.length > 3 ? ` y ${ls.length - 3} más` : "");
  const motivoDe = (l: ItemPedido | undefined) => (l ? pasoAConsulta.get(l)?.motivo ?? "consulta" : null);
  for (const op of operaciones) {
    await registrarActividad(adminActividad, {
      actor: ctx.actor,
      accion: "pedido.crear",
      entidad: "operacion",
      entidad_id: op.id,
      codigo: op.code,
      resumen:
        `Hizo un pedido desde la tienda por ${montoTxt(op.monto, op.moneda)}: ${listaTxt(op.lineas)}` +
        (aConsultaPorStock > 0
          ? ` · ${aConsultaPorStock} ${aConsultaPorStock === 1 ? "entrada pasó" : "entradas pasaron"} a consulta por falta de stock`
          : ""),
      detalle: {
        envio_id: envioId,
        moneda: op.moneda,
        monto: op.monto,
        comision: comisionDe(op.lineas),
        cantidad: op.cantidad,
        lineas: op.lineas.map((l) => ({
          evento: l.evento,
          sector: l.sector,
          fecha_evento: l.fecha_evento,
          cantidad: l.cantidad,
          monto: l.monto,
          ticket_id: l.ticket_id,
        })),
        a_consulta_por_stock: aConsultaPorStock,
        // Lo que del mismo envío fue a consulta (y por qué).
        consultas: consultasCreadas.map((c) => ({
          id: c.id,
          code: c.code,
          evento: c.evento,
          cantidad: lineaDeConsulta.get(c.id)?.cantidad ?? null,
          motivo: motivoDe(lineaDeConsulta.get(c.id)),
        })),
        idioma,
      },
      origen: "tienda",
    });
  }
  for (const c of consultasCreadas) {
    const l = lineaDeConsulta.get(c.id);
    if (!l) continue;
    const paso = pasoAConsulta.get(l);
    // Si la línea se partió por stock: la operación que se llevó lo que había.
    const enPedido = paso?.enPedido ?? null;
    const op = enPedido ? operaciones.find((o) => o.lineas.includes(enPedido)) : undefined;
    let resumen = `Consultó por ${detalle(l)}`;
    if (paso?.motivo === "sin_stock") {
      resumen =
        `Pidió ${detalle(l)} sin stock: pasó a consulta` +
        (op && enPedido ? ` (de ${paso.pedidas} pedidas, ${enPedido.cantidad} siguieron en el pedido ${op.code})` : "");
    } else if (paso?.motivo === "sin_precio") {
      resumen = `Pidió ${detalle(l)} sin precio cargado: pasó a consulta`;
    }
    await registrarActividad(adminActividad, {
      actor: ctx.actor,
      accion: "consulta.crear",
      entidad: "consulta",
      entidad_id: c.id,
      codigo: c.code,
      resumen,
      detalle: {
        envio_id: envioId,
        evento: l.evento,
        sector: l.sector,
        fecha_evento: l.fecha_evento,
        cantidad: l.cantidad,
        moneda: l.moneda ?? null,
        ticket_id: l.ticket_id,
        motivo: paso?.motivo ?? "consulta",
        ...(paso ? { pedidas: paso.pedidas } : {}),
        // Aparece también en el historial de esa operación.
        ...(op ? { operacion_id: op.id, operacion_code: op.code } : {}),
        operaciones: operaciones.map((o) => ({ id: o.id, code: o.code })),
        idioma,
      },
      origen: "tienda",
    });
  }

  // 2) Un solo aviso a los vendedores (WhatsApp + email) con todas las
  // entradas del pedido. Best-effort: si falla o no está configurado, las
  // operaciones ya quedaron registradas arriba.
  const totalEntradas = parsed.reduce((a, p) => a + p.cantidad, 0);
  const bloques: string[] = [];

  for (const op of operaciones) {
    const ls = op.lineas
      .map((l, i) => `  ${i + 1}) ${detalle(l)} — ${formatMonto(l.monto, op.moneda)}`)
      .join("\n");
    bloques.push(`OPERACIÓN ${op.code} — ${formatMonto(op.monto, op.moneda)}\n${ls}`);
  }
  if (consultasCreadas.length > 0) {
    const ls = lineasConsulta
      .map((l, i) => `  ${i + 1}) ${detalle(l)} · ${consultasCreadas[i]?.code ?? ""}`)
      .join("\n");
    bloques.push(`A CONSULTAR (${consultasCreadas.length})\n${ls}`);
  }

  const mensaje =
    `🎟️ Nuevo pedido en la tienda (${totalEntradas} ${totalEntradas === 1 ? "entrada" : "entradas"})\n` +
    `Cliente: ${quien}\n\n` +
    bloques.join("\n\n") +
    `\n\nAccionalo desde el panel.`;
  const asunto = `🎟️ Nuevo pedido (${totalEntradas}) — ${ctx.comprador}`;

  // Resumen en UNA línea para la plantilla de WhatsApp: sus parámetros no
  // aceptan saltos de línea. El texto largo va igual por email y como fallback
  // cuando todavía no hay plantilla configurada.
  const tipoEnvio = tipoDelEnvio(lineasPedido, lineasConsulta);
  // Un total por moneda: "$ 1.200.000 + US$ 500,00". Nunca se suman entre sí.
  const totalCorto =
    operaciones.length > 0
      ? operaciones.map((o) => formatMonto(o.monto, o.moneda)).join(" + ") +
        (consultasCreadas.length > 0 ? " + a cotizar" : "")
      : "a cotizar";

  const avisoPedido = {
    tipo: TIPO_ENVIO_LABEL[tipoEnvio],
    cliente: quien,
    entradas: totalEntradas,
    detalle: detalleDeLineas(lineasPedido, lineasConsulta),
    total: totalCorto,
    texto: mensaje,
  };
  // Link directo a lo que entró (un solo pedido o una sola consulta: su
  // código en el buscador del Panel; si son varios, el filtro).
  const urlPedidos = operaciones.length === 1 ? `/admin?q=${encodeURIComponent(operaciones[0].code)}` : "/admin?filtro=nuevos";
  const urlConsultas =
    consultasCreadas.length === 1 ? `/admin?q=${encodeURIComponent(consultasCreadas[0].code)}` : "/admin?filtro=a_cotizar";
  const base = baseUrlDe(request);
  const enviarWa = (para: string[] | undefined, url: string) =>
    notificarVendedores({ ...avisoPedido, link: `${base}${url}` }, para);
  const admin = isMock() ? null : createAdminSupabase();
  const datos = { cliente: ctx.comprador, detalle: avisoPedido.detalle, total: totalCorto };

  // Campana del equipo + WhatsApp (ver lib/avisos-equipo). Un pedido lo
  // acciona el admin; una consulta la puede cotizar también el moderador. En
  // un envío mixto el admin recibe UN aviso (el del pedido, con todo) y el
  // moderador el de la consulta.
  const avisos: Promise<{ whatsapp: WhatsappResult | null }>[] = [];
  if (operaciones.length > 0) {
    avisos.push(
      avisarEquipo(
        admin,
        { tipo: "nuevo_pedido", ref: envioId, datos, url: urlPedidos, operacion_id: operaciones[0].id, roles: ["administrador"] },
        enviarWa
      )
    );
  }
  if (consultasCreadas.length > 0) {
    avisos.push(
      avisarEquipo(
        admin,
        {
          tipo: "nueva_consulta",
          ref: envioId,
          datos,
          url: urlConsultas,
          consulta_id: consultasCreadas[0].id,
          roles: operaciones.length > 0 ? ["moderador"] : ["administrador", "moderador"],
          // En un envío mixto la lista fija ya recibió el aviso del pedido:
          // acá solo van los moderadores que lo activaron.
          listaFija: operaciones.length === 0,
        },
        enviarWa
      )
    );
  }
  const [resultados, mail] = await Promise.all([Promise.all(avisos), notificarVendedoresEmail(asunto, mensaje)]);
  const wa: WhatsappResult =
    resultados.map((r) => r.whatsapp).find((r): r is WhatsappResult => r !== null) ??
    { ok: false, error: "No había a quién avisar por WhatsApp.", noConfigurado: true };

  return NextResponse.json(
    {
      ok: true,
      // `count` sigue siendo la cantidad de entradas del envío (lo que el
      // carrito muestra); ahora además se devuelve qué se creó con cada una.
      count: totalEntradas,
      // `operacion` (la primera) se mantiene por compatibilidad; un carrito
      // con pesos y dólares devuelve las dos en `operaciones`.
      operacion: operaciones[0] ? { id: operaciones[0].id, code: operaciones[0].code } : null,
      operaciones: operaciones.map((o) => ({ id: o.id, code: o.code, moneda: o.moneda })),
      consultas: consultasCreadas.map((c) => ({ id: c.id, code: c.code })),
      // Entradas pedidas que no tenían stock y quedaron como consulta.
      aConsultaPorStock,
      // El error se manda al cliente (no solo el booleano) para poder ver el
      // motivo real desde la pestaña Network sin tener que ir a buscar los
      // logs del servidor — Meta no dice mucho más que "rejected" en la UI.
      whatsapp: wa.ok
        ? { ok: true, enviados: wa.enviados }
        : { ok: false, noConfigurado: wa.noConfigurado ?? false, error: wa.error },
      email: mail.ok
        ? { ok: true }
        : { ok: false, noConfigurado: mail.noConfigurado ?? false },
    },
    { status: 201 }
  );
}
