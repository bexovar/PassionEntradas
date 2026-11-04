import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { clientePuedeCancelar, clientePuedePedirCancelacion, estadoPublicoDe, type EstadoConsulta, type Moneda } from "@/lib/operaciones";
import { estadoCotizacion } from "@/lib/cotizaciones";
import { textoPagoDe } from "@/lib/textos";
import { MisPedidos, type PedidoView } from "@/components/tienda/MisPedidos";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import {
  isMock,
  mockFacturaDeOperacion,
  mockGetTextosPago,
  mockListConsultasCliente,
  mockListPedidosCliente,
  MOCK_USER,
} from "@/lib/mock-db";

// "Mis pedidos" del cliente: sus pedidos/consultas desde la tienda con el
// estado de cada uno (que se actualiza a medida que el staff acciona la
// operación), el link público de seguimiento y la factura si ya se emitió.
// Acceso reafirmado en el servidor (área privada).
//
// La lista junta DOS orígenes: las operaciones (pedidos con precio cerrado, y
// las consultas que el staff ya cargó) y las consultas todavía pendientes, que
// viven en su propia tabla y aún no son una operación. Sin esto último el
// cliente manda una consulta desde la tienda y no la ve en ningún lado.
export const dynamic = "force-dynamic";

type OpRow = {
  id: string;
  code: string;
  tipo: string;
  evento: string;
  sector: string | null;
  cantidad: number | null;
  fecha_evento: string | null;
  created_at: string;
  status: any;
  entrada_recibida_at: string | null;
  pago_confirmado_at: string | null;
  cerrada_at: string | null;
  confirmada_at: string | null;
  cancelada_por: string | null;
  monto: number;
  moneda: Moneda;
};

type ConsultaRow = {
  id: string;
  code: string;
  evento: string;
  sector: string | null;
  cantidad: number | null;
  fecha_evento: string | null;
  created_at: string;
  estado: string;
  moneda: Moneda | null;
  cotizacion_monto: number | null;
  cotizacion_version: number | null;
  vence_at: string | null;
};

function toView(
  o: OpRow,
  facturaId: string | null,
  textos: Record<string, string>
): PedidoView {
  const estado = estadoPublicoDe(o as any);
  return {
    id: o.id,
    code: o.code,
    // Una carga del staff a su nombre es un pedido más para el cliente.
    tipo: o.tipo === "consulta" ? "consulta" : "pedido",
    evento: o.evento,
    sector: o.sector ?? null,
    cantidad: o.cantidad ?? 1,
    fecha_evento: o.fecha_evento ?? null,
    created_at: o.created_at,
    estado,
    monto: Number(o.monto) || null,
    moneda: o.moneda ?? null,
    puedeCancelar: clientePuedeCancelar(o as any),
    puedePedirCancelacion: clientePuedePedirCancelacion(o as any),
    canceladaPorCliente: o.cancelada_por === "cliente",
    // Las instrucciones de pago aparecen recién cuando le pedimos que pague.
    textoPago: estado === "listo_para_pagar" ? textoPagoDe(textos, o.moneda) : null,
    cotizacion: null,
    facturaId,
    seguible: true,
  };
}

// Consulta todavía sin operación: pendiente, cotizada (esperando que la
// acepte), o cerrada sin pedido (cancelada / descartada / rechazada).
function consultaToView(c: ConsultaRow): PedidoView {
  const est = estadoCotizacion({ estado: c.estado as EstadoConsulta, vence_at: c.vence_at });
  const cotizada = c.estado === "cotizada";
  return {
    id: c.id,
    code: c.code,
    tipo: "consulta",
    evento: c.evento,
    sector: c.sector ?? null,
    cantidad: c.cantidad ?? 1,
    fecha_evento: c.fecha_evento ?? null,
    created_at: c.created_at,
    estado:
      c.estado === "cancelada"
        ? "cancelada"
        : c.estado === "descartada"
          ? "consulta_descartada"
          : c.estado === "rechazada"
            ? "consulta_rechazada"
            : est === "vencida"
              ? "consulta_vencida"
              : cotizada
                ? "consulta_cotizada"
                : "consulta_recibida",
    // La cotización que le mandamos: lo que va a pagar si la acepta.
    monto: cotizada ? Number(c.cotizacion_monto) || null : null,
    moneda: cotizada ? c.moneda ?? "USD" : null,
    cotizacion: cotizada ? { version: c.cotizacion_version ?? 1, venceAt: c.vence_at } : null,
    puedeCancelar: c.estado === "pendiente",
    puedePedirCancelacion: false,
    canceladaPorCliente: c.estado === "cancelada",
    textoPago: null,
    facturaId: null,
    seguible: false,
  };
}

const masNuevoPrimero = (a: PedidoView, b: PedidoView) =>
  b.created_at.localeCompare(a.created_at);

export default async function MisPedidosPage() {
  let pedidos: PedidoView[] = [];

  if (isMock()) {
    const ops = mockListPedidosCliente(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      MOCK_USER.email
    );
    const consultas = mockListConsultasCliente(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      MOCK_USER.email
    );
    const textos = mockGetTextosPago();
    pedidos = [
      ...ops.map((o) =>
        toView(o as unknown as OpRow, mockFacturaDeOperacion(o.id)?.id ?? null, textos)
      ),
      ...consultas.map((c) => consultaToView(c as unknown as ConsultaRow)),
    ].sort(masNuevoPrimero);
  } else {
    const user = await usuarioVerificado();
    if (!user || !puedeVerTienda(getRol(user))) redirect("/ingresar");

    // Las tablas son deny-all para el cliente; leemos lo suyo con service role,
    // filtrando por su cliente_id (nunca ve los de otros).
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("operaciones")
      .select(
        "id, code, tipo, evento, sector, cantidad, fecha_evento, created_at, status, entrada_recibida_at, pago_confirmado_at, cerrada_at, confirmada_at, cancelada_por, monto, moneda"
      )
      .eq("cliente_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    const ops = (data ?? []) as OpRow[];

    // Las pendientes y cotizadas, y las cerradas sin pedido del último mes (para que
    // vea qué pasó con ellas). Una consulta ya convertida se ve como la
    // operación que originó; mostrar las dos duplicaría el mismo pedido.
    const haceUnMes = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: dataC } = await admin
      .from("consultas")
      .select("id, code, evento, sector, cantidad, fecha_evento, created_at, estado, moneda, cotizacion_monto, cotizacion_version, vence_at")
      .eq("cliente_id", user.id)
      .or(`estado.in.(pendiente,cotizada),and(estado.in.(cancelada,descartada,rechazada),updated_at.gte.${haceUnMes})`)
      .order("created_at", { ascending: false })
      .limit(200);
    const consultas = (dataC ?? []) as ConsultaRow[];

    // Facturas emitidas para estos pedidos (map operacion_id -> factura_id),
    // así el cliente accede al recibo desde su seguimiento.
    const facturaPorOp = new Map<string, string>();
    if (ops.length > 0) {
      const { data: facs } = await admin
        .from("facturas")
        .select("id, operacion_id")
        .in(
          "operacion_id",
          ops.map((o) => o.id)
        );
      for (const f of (facs ?? []) as { id: string; operacion_id: string }[]) {
        facturaPorOp.set(f.operacion_id, f.id);
      }
    }

    // Instrucciones de pago: solo si algún pedido está listo para pagar.
    const textos: Record<string, string> = {};
    if (ops.some((o) => estadoPublicoDe(o as any) === "listo_para_pagar")) {
      const { data: tx } = await admin.from("textos_config").select("key, value").like("key", "pago_%");
      for (const r of (tx ?? []) as { key: string; value: string }[]) textos[r.key] = r.value;
    }

    pedidos = [
      ...ops.map((o) => toView(o, facturaPorOp.get(o.id) ?? null, textos)),
      ...consultas.map(consultaToView),
    ].sort(masNuevoPrimero);
  }

  return <MisPedidos pedidos={pedidos} />;
}
