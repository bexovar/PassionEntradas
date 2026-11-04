import { notFound } from "next/navigation";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import StatusStub from "@/components/StatusStub";
import AutoRefresh from "@/components/AutoRefresh";
import { WhatsAppFlotante } from "@/components/WhatsAppFlotante";
import { estadoPublicoDe, type ItemPublico, type OperacionPublica, type Status } from "@/lib/operaciones";
import { claveTextoPago, textoPagoDe } from "@/lib/textos";
import { isMock, mockGetTextosPago, mockListItems, mockOpPublica } from "@/lib/mock-db";
import { MARCA_SEGUIMIENTO } from "@/lib/marca-seguimiento";

// Página pública read-only. Se accede por el uuid (impredecible).
// Lee vía el RPC `operacion_publica`, que exige el uuid exacto y devuelve
// SOLO campos seguros: evento, monto, estado, aliases y fecha.
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

  let op: OperacionPublica;
  let items: ItemPublico[] = [];

  if (isMock()) {
    const mock = mockOpPublica(params.id);
    if (!mock) notFound();
    op = mock;
    items = mockListItems(params.id).map((i) => ({
      evento: i.evento,
      sector: i.sector,
      fecha_evento: i.fecha_evento,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
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
      <StatusStub op={op} items={items} textoPago={textoPago} />
      <footer className="mt-6 text-center text-xs text-muted">
        {MARCA_SEGUIMIENTO.pie}
      </footer>
      {/* Seguimiento de un pedido: el WhatsApp ya sale con su número. */}
      <WhatsAppFlotante contexto={{ tipo: "pedido", codigo: op.code }} />
    </main>
  );
}
