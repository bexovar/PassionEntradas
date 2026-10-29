import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol, nombreDe, puedeVerTienda } from "@/lib/auth";
import { notificarVendedoresEmail } from "@/lib/email";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { notificarAviso } from "@/lib/whatsapp";
import { isMock, MOCK_USER, mockAceptarCotizacion, mockListConsultas } from "@/lib/mock-db";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { avisoDeSobreventa, type LineaDescontada } from "@/lib/stock";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// POST /api/consultas/[id]/aceptar — la cotización pasa a ser un pedido.
//
// Dos caminos, los dos por la misma función atómica de la base
// (aceptar_cotizacion: bloquea la fila, valida estado/versión/vencimiento/
// dueño, crea la operación y marca la consulta en una sola transacción):
//
//   - el CLIENTE, logueado, desde Mis pedidos: { version }. Solo la suya.
//   - el STAFF, cuando el cliente dijo que sí por WhatsApp:
//     { version, via: "whatsapp" }. Queda registrado quién lo marcó.
//
// No hay links de un click por email: aceptar exige sesión y un botón.
const CLIENTE_DEMO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Versión inválida" }, { status: 400 });
  }
  const porWhatsapp = body?.via === "whatsapp";

  let clienteId: string | null;
  let quien: string;

  if (isMock()) {
    clienteId = porWhatsapp ? null : CLIENTE_DEMO;
    quien = MOCK_USER.email;
    const r = mockAceptarCotizacion(params.id, {
      version,
      clienteId,
      via: porWhatsapp ? "whatsapp" : "web",
      quien,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    refrescarTienda();
    // Por WhatsApp lo registra el admin demo; en la web acepta el cliente demo.
    const actor: Actor = porWhatsapp
      ? actorDemo()
      : { id: CLIENTE_DEMO, email: MOCK_USER.email, nombre: null, rol: "cliente" };
    const cons = mockListConsultas().find((x) => x.id === params.id) ?? null;
    await registrarActividad(
      null,
      actividadAceptar(params.id, cons, { id: r.op.id, code: r.op.code }, porWhatsapp, version, actor, null)
    );
    return NextResponse.json({ ok: true, operacion: { id: r.op.id, code: r.op.code } });
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const rol = getRol(user);
  if (porWhatsapp) {
    // Registrar una aceptación por WhatsApp es cosa del staff.
    if (!esStaff(rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    clienteId = null;
    quien = nombreDe(user) ?? user.email ?? "staff";
  } else {
    if (!puedeVerTienda(rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    clienteId = user.id;
    quien = user.email ?? user.id;
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .rpc("aceptar_cotizacion", {
      p_consulta: params.id,
      p_version: version,
      p_cliente: clienteId,
      p_via: porWhatsapp ? "whatsapp" : "web",
      p_quien: quien,
    })
    .maybeSingle();
  if (error) {
    // P0002 = no es suya o no existe; P0001 = estado/versión/vencimiento. Esos
    // mensajes los escribe aceptar_cotizacion y son para el usuario; cualquier
    // otro error de la base va a los logs y el cliente ve uno genérico.
    const code = (error as { code?: string }).code;
    const status = code === "P0002" ? 404 : code === "P0001" ? 409 : 500;
    if (status === 500) console.error("[aceptar]", error.message);
    const mensaje = status === 500 ? "No pudimos aceptar la cotización. Probá de nuevo." : error.message;
    return NextResponse.json({ error: mensaje }, { status });
  }
  const op = data as { op_id: string; op_code: string } | null;
  if (!op) return NextResponse.json({ error: "No se pudo crear el pedido" }, { status: 500 });

  // El pedido nace confirmado: toma ya el stock de sus entradas propias (ver
  // lib/stock.ts). Aparte y sin trabar: el pedido ya está creado; si falla,
  // se corrige desde Entradas.
  // Problema de stock (falla o sobreventa), para el registro de actividad.
  let avisoStock: string | null = null;
  try {
    const { data: lineas, error: errStock } = await admin.rpc("stock_operacion", { p_op: op.op_id, p_tomar: true });
    if (errStock) {
      console.error(`[stock] no se pudo tomar stock de ${op.op_id}: ${errStock.message}`);
      avisoStock = `No se pudo tomar stock: ${errStock.message}`;
    } else {
      const sobre = avisoDeSobreventa(lineas as LineaDescontada[]);
      if (sobre) console.warn(`[stock] ${op.op_code}: ${sobre}`);
      avisoStock = sobre;
      refrescarTienda();
    }
  } catch (e) {
    console.error(`[stock] ${op.op_id}: ${(e as Error).message}`);
    avisoStock = `No se pudo tomar stock: ${(e as Error).message}`;
  }

  // Idioma del pedido que nace (sus emails van en ese): el de la tienda si
  // acepta el cliente, si no el que tenía la consulta. Aparte y sin
  // chequear: el pedido ya está creado y esto no lo puede tirar abajo.
  try {
    let idioma: string | null = !porWhatsapp && (body?.lang === "en" || body?.lang === "es") ? body.lang : null;
    if (!idioma) {
      const { data: cons } = await admin.from("consultas").select("idioma").eq("id", params.id).maybeSingle();
      idioma = (cons as { idioma?: string | null } | null)?.idioma ?? null;
    }
    if (idioma === "en" || idioma === "es") await admin.from("operaciones").update({ idioma }).eq("id", op.op_id);
  } catch {
    /* sin idioma: los emails van en español */
  }

  // Aviso a los vendedores. Best-effort: el pedido ya quedó creado.
  const base = baseUrlDe(request);
  try {
    const texto = `${porWhatsapp ? `${quien} registró que el cliente aceptó por WhatsApp` : `El cliente ${quien} aceptó la cotización en la web`}. Se creó el pedido ${op.op_code}.`;
    await Promise.all([
      notificarVendedoresEmail(`✅ Cotización aceptada — pedido ${op.op_code}`, texto),
      avisarEquipo(
        admin,
        {
          tipo: "cotizacion_aceptada",
          ref: op.op_id,
          datos: { code: op.op_code, quien, via: porWhatsapp ? "whatsapp" : "web" },
          url: `/admin?q=${encodeURIComponent(op.op_code)}`,
          operacion_id: op.op_id,
        },
        // Si la registró alguien del equipo (aceptó por WhatsApp), el equipo
        // ya lo sabe: queda en la campana, sin WhatsApp.
        porWhatsapp
          ? null
          : (para, url) =>
              notificarAviso(
                { aviso: `✅ Cotización aceptada · pedido ${op.op_code}`, detalle: `El cliente ${quien} la aceptó en la web`, texto, link: `${base}${url}` },
                para
              )
      ),
    ]);
  } catch (e) {
    console.error("[aceptar] no se pudo avisar a los vendedores:", e);
  }

  // La consulta ya convertida: código, evento y la cotización aceptada. Si la
  // lectura falla se registra igual, con lo que devolvió la función.
  const { data: cons } = await admin
    .from("consultas")
    .select("code, evento, sector, cantidad, cliente_email, comprador_alias, cotizacion_monto, cotizacion_fee, moneda")
    .eq("id", params.id)
    .maybeSingle();
  await registrarActividad(
    admin,
    actividadAceptar(
      params.id,
      (cons as ConsultaAceptada | null) ?? null,
      { id: op.op_id, code: op.op_code },
      porWhatsapp,
      version,
      actorDe(user),
      avisoStock
    )
  );
  return NextResponse.json({ ok: true, operacion: { id: op.op_id, code: op.op_code } });
}

type ConsultaAceptada = {
  code?: string | null;
  evento?: string | null;
  sector?: string | null;
  cantidad?: number | null;
  cliente_email?: string | null;
  comprador_alias?: string | null;
  cotizacion_monto?: number | null;
  cotizacion_fee?: number | null;
  moneda?: string | null;
};

const montoTxt = (n: number, moneda: string | null | undefined) =>
  `${moneda ?? "USD"} ${new Intl.NumberFormat("es-AR").format(n)}`;

// Una sola línea, de la consulta, con detalle.operacion_id: así aparece
// también en el historial del pedido que nació.
// "Aceptó la cotización de USD 350 · se creó el pedido BX-…" (cliente, web)
// "Registró que juan@x.com aceptó por WhatsApp la cotización de USD 350 · …" (staff)
function actividadAceptar(
  consultaId: string,
  c: ConsultaAceptada | null,
  op: { id: string; code: string },
  porWhatsapp: boolean,
  version: number,
  actor: Actor | null,
  avisoStock: string | null
) {
  const monto = c?.cotizacion_monto != null ? Number(c.cotizacion_monto) : null;
  const precio = monto != null ? ` de ${montoTxt(monto, c?.moneda)}` : "";
  const cliente = c?.cliente_email || c?.comprador_alias || "el cliente";
  const resumen = porWhatsapp
    ? `Registró que ${cliente} aceptó por WhatsApp la cotización${precio} · se creó el pedido ${op.code}`
    : `Aceptó la cotización${precio} · se creó el pedido ${op.code}`;
  return {
    actor,
    accion: "consulta.aceptar",
    entidad: "consulta",
    entidad_id: consultaId,
    codigo: c?.code ?? null,
    resumen,
    detalle: {
      operacion_id: op.id,
      operacion_code: op.code,
      via: porWhatsapp ? "whatsapp" : "web",
      version,
      evento: c?.evento ?? null,
      sector: c?.sector ?? null,
      cantidad: c?.cantidad ?? null,
      moneda: c?.moneda ?? null,
      monto,
      comision: c?.cotizacion_fee != null ? Number(c.cotizacion_fee) : null,
      cliente_email: c?.cliente_email ?? null,
      ...(avisoStock ? { stock: avisoStock } : {}),
    },
    origen: porWhatsapp ? ("panel" as const) : ("tienda" as const),
  };
}
