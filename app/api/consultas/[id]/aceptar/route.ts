import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol, nombreDe, puedeVerTienda } from "@/lib/auth";
import { notificarVendedoresEmail } from "@/lib/email";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { notificarAviso } from "@/lib/whatsapp";
import { isMock, MOCK_USER, mockAceptarCotizacion } from "@/lib/mock-db";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { avisoDeSobreventa, type LineaDescontada } from "@/lib/stock";

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
    // P0002 = no es suya o no existe; P0001 = estado/versión/vencimiento.
    const code = (error as { code?: string }).code;
    const status = code === "P0002" ? 404 : code === "P0001" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  const op = data as { op_id: string; op_code: string } | null;
  if (!op) return NextResponse.json({ error: "No se pudo crear el pedido" }, { status: 500 });

  // El pedido nace confirmado: toma ya el stock de sus entradas propias (ver
  // lib/stock.ts). Aparte y sin trabar: el pedido ya está creado; si falla,
  // se corrige desde Entradas.
  try {
    const { data: lineas, error: errStock } = await admin.rpc("stock_operacion", { p_op: op.op_id, p_tomar: true });
    if (errStock) console.error(`[stock] no se pudo tomar stock de ${op.op_id}: ${errStock.message}`);
    else {
      const sobre = avisoDeSobreventa(lineas as LineaDescontada[]);
      if (sobre) console.warn(`[stock] ${op.op_code}: ${sobre}`);
      refrescarTienda();
    }
  } catch (e) {
    console.error(`[stock] ${op.op_id}: ${(e as Error).message}`);
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
  return NextResponse.json({ ok: true, operacion: { id: op.op_id, code: op.op_code } });
}
