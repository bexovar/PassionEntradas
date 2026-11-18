import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import { computeMetrics, metricasDominantes, type Metrics } from "@/lib/metrics";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AppHeader from "@/components/AppHeader";
import AutoRefresh from "@/components/AutoRefresh";
import BottomNav from "@/components/BottomNav";
import type { Consulta, Operacion, OperacionItem } from "@/lib/operaciones";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import { filtroDeParams } from "@/lib/panel-filtros";
import {
  isMock,
  MOCK_USER,
  mockListConsultas,
  mockListItems,
  mockListOps,
} from "@/lib/mock-db";

export const dynamic = "force-dynamic";

// Deriva la URL base para armar los links públicos.
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

// Módulo del administrador: chequea y actualiza los estados.
export default async function AdminPage({
  searchParams,
}: {
  // ?filtro=… viene de las tarjetas de plata de Métricas.
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  let email: string | null | undefined;
  let ops: Operacion[];
  let items: OperacionItem[] = [];
  // Consultas sin cotizar: van en la MISMA lista que las operaciones. Las ya
  // convertidas no se traen — se ven como la operación que originaron.
  let consultas: Consulta[] = [];
  // Comisión y ventas acumuladas para los importes del panel (TKT-22).
  let acumulados: Metrics;

  if (isMock()) {
    email = MOCK_USER.email;
    ops = mockListOps();
    items = ops.flatMap((o) => mockListItems(o.id));
    consultas = mockListConsultas().filter((c) => c.estado === "pendiente" || c.estado === "cotizada");
    acumulados = computeMetrics(mockListOps());
  } else {
    const user = await usuarioVerificado();

    // Refuerzo por si el middleware no corrió (defensa en profundidad).
    if (!user) {
      redirect("/ingresar");
    }
    if (getRol(user) !== "administrador") {
      redirect("/moderador");
    }
    email = user.email;

    // Lectura con service role: la tabla quedó en RLS deny-all (sin policy
    // de select para authenticated), así que la sesión del usuario no ve
    // filas. El rol ya fue validado arriba.
    // Tope de 1000: con historial grande el payload de "todo" crece sin
    // límite (el stress test midió ~4,7 MB con 20k filas). Las más viejas
    // que quedan afuera ya están cerradas o canceladas.
    // Columnas explícitas: lo que consume el panel (el tipo Operacion).
    // Evita arrastrar columnas internas (created_by) en un payload que se
    // re-baja entero en cada refresh.
    const { data } = await createAdminSupabase()
      .from("operaciones")
      .select(
        "id, code, evento, comprador_alias, vendedor_alias, monto, moneda, cantidad, fee, cuenta_debitar, status, entrada_recibida_at, pago_confirmado_at, pago_proveedor_at, cerrada_at, entrada_recibida_por, pago_confirmado_por, pago_proveedor_por, cerrada_por, confirmada_at, confirmada_por, cancelada_at, cancelada_por, pago_pedido_at, pago_informado_at, pago_informado_por, reembolso_at, reembolso_por, reembolsado_at, reembolsado_por, fecha_evento, notas, ticket_id, tipo, cliente_id, cliente_email, sector, envio_id, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    ops = (data ?? []) as Operacion[];

    // Líneas de esas operaciones, en UNA consulta para todas: una por
    // operación sería N+1 con 1000 filas en pantalla.
    if (ops.length > 0) {
      const { data: filas } = await createAdminSupabase()
        .from("operacion_items")
        .select("id, operacion_id, ticket_id, evento, sector, fecha_evento, cantidad, precio_unitario")
        .in("operacion_id", ops.map((o) => o.id));
      items = (filas ?? []) as OperacionItem[];
    }

    const { data: cons } = await createAdminSupabase()
      .from("consultas")
      .select(
        "id, code, envio_id, cliente_id, cliente_email, comprador_alias, ticket_id, evento, sector, fecha_evento, cantidad, moneda, notas, estado, operacion_id, resuelta_por, resuelta_at, created_at, updated_at, cotizacion_monto, cotizacion_fee, cotizacion_version, cotizada_at, cotizada_por, cotizada_por_admin, vence_at"
      )
      .in("estado", ["pendiente", "cotizada"])
      .order("created_at", { ascending: false })
      .limit(500);
    consultas = (cons ?? []) as Consulta[];

    // Mismo RPC que Métricas: suma en la base, todo el historial.
    const { data: agregados } = await createAdminSupabase().rpc("metricas_operaciones");
    acumulados = metricasDominantes((agregados ?? []) as any[]);
  }

  return (
    // pb-24 solo en móvil: aire para que la BottomNav no tape la última card.
    <main className="min-h-svh pb-16 md:pb-10">
      <AppHeader subtitle="Administración" email={email} nav />
      {/* Lista viva: consulta la versión en intervalo y solo refresca el
          server component cuando hubo cambios; el dashboard sincroniza su
          estado local cuando cambia `initial`. */}
      <AutoRefresh intervalMs={15000} versionUrl="/api/operaciones/version" />
      <AdminDashboard
        initial={ops}
        items={items}
        consultas={consultas}
        baseUrl={getBaseUrl()}
        filtroInicial={filtroDeParams(searchParams)}
        busquedaInicial={typeof searchParams?.q === "string" ? searchParams.q.slice(0, 120) : ""}
        acumulados={acumulados}
      />
      <BottomNav />
    </main>
  );
}
