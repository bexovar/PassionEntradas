import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { clientePuedeCancelar } from "@/lib/operaciones";
import { notificarVendedoresEmail } from "@/lib/email";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { notificarAviso } from "@/lib/whatsapp";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMock,
  mockClienteCancelarConsulta,
  mockClienteCancelarOp,
} from "@/lib/mock-db";

// POST /api/mis-pedidos/[id]/cancelar — el CLIENTE cancela su pedido o su
// consulta desde Mis pedidos.
//
// Body: { tipo: "pedido" | "consulta" }
//
// Reglas:
//   - solo lo suyo (cliente_id = su usuario; si no es suyo, 404 como si no
//     existiera);
//   - un pedido, solo antes de que se le pida pagar (pasos 1–2: recibido o
//     confirmado). El trigger de la base lo vuelve a chequear, y el UPDATE va
//     condicionado a que no haya hitos: dos clicks cruzados con el admin no
//     pueden cancelar un pedido que ya avanzó;
//   - una consulta, solo si sigue pendiente.
//
// Stock: un pedido confirmado ya tomó el suyo (lib/stock.ts); cancelarlo lo
// devuelve.
const CLIENTE_DEMO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const tipo = body?.tipo;
  if (tipo !== "pedido" && tipo !== "consulta") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  if (isMock()) {
    const r =
      tipo === "pedido"
        ? mockClienteCancelarOp(params.id, CLIENTE_DEMO)
        : mockClienteCancelarConsulta(params.id, CLIENTE_DEMO);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
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
  const ahora = new Date().toISOString();
  const quien = user.email ?? user.id;

  if (tipo === "consulta") {
    const { data, error } = await admin
      .from("consultas")
      .update({ estado: "cancelada", resuelta_por: "cliente", resuelta_at: ahora })
      .eq("id", params.id)
      .eq("cliente_id", user.id)
      .in("estado", ["pendiente", "cotizada"])
      .select("id, code, evento, sector")
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
        ? NextResponse.json({ error: "Esta consulta ya fue resuelta" }, { status: 409 })
        : NextResponse.json({ error: "Consulta no encontrada" }, { status: 404 });
    }
    await avisar(admin, { id: data.id, code: data.code, clase: "consulta" }, `Consulta ${data.code}`, data.evento, data.sector, quien, baseUrlDe(request));
    return NextResponse.json({ ok: true });
  }

  const { data: op } = await admin
    .from("operaciones")
    .select("id, code, evento, sector, tipo, status, confirmada_at, entrada_recibida_at, pago_confirmado_at, cerrada_at, vendedor_alias")
    .eq("id", params.id)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!op) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (!clientePuedeCancelar(op as any)) {
    return NextResponse.json(
      { error: "El pedido ya avanzó; para cancelarlo escribinos" },
      { status: 409 }
    );
  }

  const { data: upd, error } = await admin
    .from("operaciones")
    .update({ status: "cancelada", cancelada_at: ahora, cancelada_por: "cliente" })
    .eq("id", params.id)
    .eq("cliente_id", user.id)
    .neq("status", "cancelada")
    .is("entrada_recibida_at", null)
    .is("pago_confirmado_at", null)
    .is("cerrada_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    const esInvariante = (error as { code?: string }).code === "P0001";
    return NextResponse.json({ error: error.message }, { status: esInvariante ? 409 : 500 });
  }
  if (upd) {
    // Un pedido confirmado ya tomó su stock (lib/stock.ts): cancelarlo lo
    // devuelve. Sin haber tomado nada no hace nada.
    const { error: errStock } = await admin.rpc("stock_operacion", { p_op: params.id, p_tomar: false });
    if (errStock) console.error(`[stock] no se pudo devolver stock de ${params.id}: ${errStock.message}`);
    else refrescarTienda();
  }
  if (!upd) {
    return NextResponse.json(
      { error: "El pedido ya avanzó; para cancelarlo escribinos" },
      { status: 409 }
    );
  }
  await avisar(
    admin,
    { id: op.id, code: op.code, clase: "op", vendedor: op.vendedor_alias },
    `Pedido ${op.code}`,
    op.evento,
    op.sector,
    quien,
    baseUrlDe(request)
  );
  return NextResponse.json({ ok: true });
}

// Aviso a los vendedores. Best-effort: la cancelación ya quedó registrada y se
// ve en el panel aunque el email no esté configurado.
async function avisar(
  admin: SupabaseClient,
  ref: { id: string; code: string; clase: "op" | "consulta"; vendedor?: string | null },
  que: string,
  evento: string,
  sector: string | null,
  quien: string,
  base: string
) {
  const detalle = `${evento}${sector ? ` — ${sector}` : ""}`;
  const texto = `${que} (${detalle}) fue cancelado por el cliente ${quien} desde Mis pedidos.`;
  try {
    await Promise.all([
      notificarVendedoresEmail(`❌ ${que} cancelado por el cliente`, texto),
      // Campana + WhatsApp del equipo (lib/avisos-equipo).
      avisarEquipo(
        admin,
        {
          tipo: "cancelado_cliente",
          ref: ref.id,
          datos: { code: ref.code, evento: detalle, quien },
          url: `/admin?q=${encodeURIComponent(ref.code)}`,
          operacion_id: ref.clase === "op" ? ref.id : null,
          consulta_id: ref.clase === "consulta" ? ref.id : null,
          // Una consulta la cotiza también el moderador: le avisa que ya no va.
          roles: ref.clase === "consulta" ? ["administrador", "moderador"] : undefined,
          vendedor: ref.vendedor,
        },
        (para, url) => notificarAviso({ aviso: `❌ ${que} cancelado por el cliente`, detalle, texto, link: `${base}${url}` }, para)
      ),
    ]);
  } catch (e) {
    console.error("[cancelar] no se pudo avisar a los vendedores:", e);
  }
}
