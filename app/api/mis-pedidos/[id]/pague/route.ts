import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { clientePuedeInformarPago } from "@/lib/operaciones";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { notificarAviso } from "@/lib/whatsapp";
import { isMock, mockClienteInformarPago, MOCK_USER } from "@/lib/mock-db";
import { actorDe, registrarActividad, type Actor, type NuevaActividad } from "@/lib/actividad";

// POST /api/mis-pedidos/[id]/pague — el CLIENTE avisa que ya pagó (TKT-18).
//
// Es el momento de más ansiedad del flujo: mandó la plata y no hay pasarela
// que lo confirme. Con esto su pedido pasa a "Pago recibido" en pantalla y al
// equipo le llega el aviso para chequear el banco ("Pago informado" en el
// panel, TKT-21).
//
// Reglas: solo lo suyo (si no es suyo, 404 como si no existiera) y solo si
// se le pidió el pago y todavía no lo avisó ni lo verificamos. El UPDATE va
// condicionado igual: dos clicks, o un click cruzado con el admin, no pisan
// nada.
const CLIENTE_DEMO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ERROR_GENERICO = "No pudimos registrar tu aviso. Probá de nuevo o escribinos.";
const NO_ESPERA_PAGO = "Este pedido no está esperando un pago";

const COLUMNAS =
  "id, code, evento, sector, cantidad, monto, moneda, tipo, status, confirmada_at, entrada_recibida_at, pago_confirmado_at, cerrada_at, vendedor_alias, pago_pedido_at, pago_informado_at, reembolso_at, reembolsado_at";

type OpPague = {
  id: string;
  code: string;
  evento: string;
  sector: string | null;
  cantidad: number | null;
  monto: number | null;
  moneda: string | null;
  vendedor_alias?: string | null;
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (isMock()) {
    const r = mockClienteInformarPago(params.id, CLIENTE_DEMO);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await registrarActividad(
      null,
      actividad({ id: CLIENTE_DEMO, email: MOCK_USER.email, nombre: null, rol: "cliente" }, r.op as unknown as OpPague)
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
  const { data: op } = await admin
    .from("operaciones")
    .select(COLUMNAS)
    .eq("id", params.id)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!op) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (!clientePuedeInformarPago(op as any)) {
    return NextResponse.json({ error: NO_ESPERA_PAGO }, { status: 409 });
  }

  const { data: upd, error } = await admin
    .from("operaciones")
    .update({ pago_informado_at: new Date().toISOString(), pago_informado_por: "cliente" })
    .eq("id", params.id)
    .eq("cliente_id", user.id)
    .neq("status", "cancelada")
    .is("pago_informado_at", null)
    .is("pago_confirmado_at", null)
    .is("reembolso_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[pague] pedido:", error.message);
    return NextResponse.json({ error: ERROR_GENERICO }, { status: 500 });
  }
  if (!upd) return NextResponse.json({ error: NO_ESPERA_PAGO }, { status: 409 });

  await registrarActividad(admin, actividad(actorDe(user), op as OpPague));

  // Aviso al equipo (campana + WhatsApp). Best-effort: el pedido ya cambió
  // de etapa y se ve en el panel aunque el aviso falle.
  const o = op as OpPague;
  const detalle = `${o.evento}${o.sector ? ` — ${o.sector}` : ""}`;
  const base = baseUrlDe(request);
  try {
    await avisarEquipo(
      admin,
      {
        tipo: "pago_informado",
        ref: o.id,
        datos: { code: o.code, evento: detalle, quien: user.email ?? undefined },
        url: `/admin?q=${encodeURIComponent(o.code)}`,
        operacion_id: o.id,
        vendedor: o.vendedor_alias,
      },
      (para, url) =>
        notificarAviso(
          {
            aviso: `💸 Pago informado · ${o.code}`,
            detalle,
            texto: `El cliente avisó que pagó el pedido ${o.code} (${detalle}). Chequeá que entró al banco.`,
            link: `${base}${url}`,
          },
          para
        )
    );
  } catch (e) {
    console.error("[pague] no se pudo avisar al equipo:", e);
  }
  return NextResponse.json({ ok: true });
}

function actividad(actor: Actor | null, o: OpPague): NuevaActividad {
  return {
    actor,
    accion: "cliente.pago_informado",
    entidad: "operacion",
    entidad_id: o.id,
    codigo: o.code,
    resumen: `Avisó desde Mis pedidos que ya pagó: ${o.evento}${o.sector ? ` — ${o.sector}` : ""}`,
    detalle: { evento: o.evento, sector: o.sector, monto: o.monto ?? null, moneda: o.moneda ?? null },
    origen: "tienda",
  };
}
