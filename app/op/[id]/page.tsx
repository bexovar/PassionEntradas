import { notFound } from "next/navigation";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import {
  recortarParaPublico,
  vistaSeguimiento,
  type ItemSeguimiento,
  type OperacionSeguimiento,
} from "@/lib/seguimiento-publico";
import StatusStub from "@/components/StatusStub";
import AutoRefresh from "@/components/AutoRefresh";
import { WhatsAppFlotante } from "@/components/WhatsAppFlotante";
import { estadoPublicoDe, type ItemPublico, type OperacionPublica, type Status } from "@/lib/operaciones";
import { claveTextoPago, textoPagoDe } from "@/lib/textos";
import { isMock, mockGetTextosPago, mockListItems, mockOpPublica } from "@/lib/mock-db";
import { MARCA_SEGUIMIENTO } from "@/lib/marca-seguimiento";

// Página pública read-only. Se accede por el uuid (impredecible).
// Lee vía el RPC `operacion_publica`, que exige el uuid exacto y devuelve
// SOLO campos seguros: evento, estado, aliases y fechas.
//
// Dos vistas (TKT-24, lib/seguimiento-publico.ts): el link lo abre el
// pasajero de la agencia, que no puede ver lo que la agencia nos paga. Sin
// sesión, o con la de otro, la página no muestra importes y el comprador va
// por su nombre de pila. El agente dueño y el staff ven monto, precio por
// línea y nombre completo, leídos con service role (no del RPC público).
export const dynamic = "force-dynamic";

// Validación básica de uuid v4/genérico para no consultar con basura.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OperacionPublicaPage({
  params,
}: {
  params: { id: string };
}) {
  if (!UUID_RE.test(params.id)) {
    notFound();
  }

  // Lo que devuelve el RPC público (o el mock): sin importes después de 0053,
  // con importes antes. recortarParaPublico los descarta en los dos casos.
  let op: OperacionPublica & { monto?: unknown };
  let items: (ItemPublico & { precio_unitario?: unknown })[] = [];

  if (isMock()) {
    const mock = mockOpPublica(params.id);
    if (!mock) notFound();
    op = mock;
    items = mockListItems(params.id).map((i) => ({
      evento: i.evento,
      sector: i.sector,
      fecha_evento: i.fecha_evento,
      cantidad: i.cantidad,
    }));
  } else {
    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .rpc("operacion_publica", { op_id: params.id })
      .maybeSingle();

    if (error || !data) {
      notFound();
    }

    op = {
      ...(data as Omit<OperacionPublica, "status"> & { status: string }),
      status: (data as { status: string }).status as Status,
    };

    // Líneas del pedido por RPC (la tabla es deny-all y este link es anónimo).
    const { data: filas } = await supabase.rpc("operacion_items_publicos", {
      op_id: params.id,
    });
    items = (filas ?? []) as ItemPublico[];
  }

  // Por defecto, la vista pública. La sesión se mira solo si hay una: el
  // grueso del tráfico de este link es anónimo y no paga la consulta extra.
  let vista: { op: OperacionSeguimiento; items: ItemSeguimiento[] } =
    recortarParaPublico(op, items);
  if (!isMock()) {
    const user = await usuarioVerificado();
    if (user) {
      const admin = createAdminSupabase();
      const { data: priv } = await admin
        .from("operaciones")
        .select("cliente_id, monto, comprador_alias")
        .eq("id", params.id)
        .maybeSingle();
      if (
        priv &&
        vistaSeguimiento({ id: user.id, rol: getRol(user) }, priv.cliente_id) === "completa"
      ) {
        const { data: lineas, error: errLineas } = await admin
          .from("operacion_items")
          .select("evento, sector, fecha_evento, cantidad, precio_unitario")
          .eq("operacion_id", params.id)
          .order("created_at", { ascending: true });
        vista = {
          op: { ...vista.op, monto: Number(priv.monto), comprador_alias: priv.comprador_alias },
          // Si falla la lectura de las líneas, el dueño no se queda sin ellas:
          // ve las públicas (sin precio), igual que cualquiera con el link.
          items: errLineas
            ? vista.items
            : ((lineas ?? []) as (ItemPublico & { precio_unitario: number })[]).map((i) => ({
                evento: i.evento,
                sector: i.sector,
                fecha_evento: i.fecha_evento,
                cantidad: i.cantidad,
                precio_unitario: Number(i.precio_unitario),
              })),
        };
      }
    }
  }

  // "Para pagar": el link muestra cómo pagar (el texto de la moneda que se
  // carga en el panel). Solo ese texto, y solo en ese paso; la tabla es
  // deny-all, se lee con service role del lado del server.
  let textoPago: string | null = null;
  if (estadoPublicoDe(op) === "listo_para_pagar") {
    if (isMock()) {
      textoPago = textoPagoDe(mockGetTextosPago(), op.moneda);
    } else {
      const { data: tx } = await createAdminSupabase()
        .from("textos_config")
        .select("key, value")
        .eq("key", claveTextoPago(op.moneda))
        .maybeSingle();
      textoPago = tx?.value?.trim() || null;
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      {/* Repolea una versión mínima y solo re-baja la página si la operación
          cambió: este link vive abierto en los grupos, es el tráfico grande. */}
      <AutoRefresh versionUrl={`/api/op/${params.id}/version`} />
      <StatusStub op={vista.op} items={vista.items} textoPago={textoPago} />
      <footer className="mt-6 text-center text-xs text-muted">
        {MARCA_SEGUIMIENTO.pie}
      </footer>
      {/* Seguimiento de un pedido: el WhatsApp ya sale con su número. */}
      <WhatsAppFlotante contexto={{ tipo: "pedido", codigo: op.code }} />
    </main>
  );
}
