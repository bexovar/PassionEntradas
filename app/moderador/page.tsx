import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { esStaff, getRol } from "@/lib/auth";
import ModeradorDashboard from "@/components/moderador/ModeradorDashboard";
import AppHeader from "@/components/AppHeader";
import AutoRefresh from "@/components/AutoRefresh";
import BottomNav from "@/components/BottomNav";
import type { Consulta, Operacion } from "@/lib/operaciones";
import { computeMetrics, type Metrics, metricasDominantes } from "@/lib/metrics";
import { isMock, MOCK_USER, mockListConsultas, mockListOps } from "@/lib/mock-db";
import { usuarioVerificado } from "@/lib/usuario-verificado";

export const dynamic = "force-dynamic";

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

// Módulo del moderador: carga la entrada a vender con los datos de
// comprador y vendedor. También lo puede usar el admin para cargar.
export default async function ModeradorPage({
  searchParams,
}: {
  searchParams?: { evento?: string; ticket?: string };
}) {
  let email: string | null | undefined;
  let esAdmin: boolean;
  let ops: Operacion[];
  let metrics: Metrics;
  // Consultas de la tienda sin cotizar: el moderador también las cotiza.
  let consultas: Consulta[] = [];

  if (isMock()) {
    email = MOCK_USER.email;
    esAdmin = true;
    ops = mockListOps(10);
    metrics = computeMetrics(mockListOps());
    consultas = mockListConsultas().filter((c) => c.estado === "pendiente" || c.estado === "cotizada");
  } else {
    const user = await usuarioVerificado();

    if (!user) {
      redirect("/ingresar");
    }
    const rol = getRol(user);
    // Refuerzo del middleware: sin rol del panel no hay módulo de carga.
    if (!esStaff(rol)) {
      redirect("/ingresar");
    }
    email = user.email;
    esAdmin = rol === "administrador";

    // Últimas operaciones cargadas, para referencia y para copiar links.
    // Con service role: la tabla está en RLS deny-all y la sesión del
    // usuario no ve filas (la sesión solo se usa para validar quién es).
    // Columnas explícitas: notas y cuenta_debitar son datos internos del
    // panel de administración, el módulo del moderador no los necesita.
    const admin = createAdminSupabase();
    const [recentes, agregados, pendientes] = await Promise.all([
      admin
        .from("operaciones")
        .select(
          "id, code, evento, comprador_alias, vendedor_alias, monto, moneda, cantidad, fee, status, entrada_recibida_at, pago_confirmado_at, pago_proveedor_at, cerrada_at, confirmada_at, cancelada_at, cancelada_por, fecha_evento, ticket_id, tipo, cliente_email, sector, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(10),
      // Métricas agregadas en la base (RPC): antes se bajaban TODAS las
      // filas históricas para sumar en JS — la única query sin tope del
      // panel, y crecía para siempre.
      admin.rpc("metricas_operaciones"),
      admin
        .from("consultas")
        .select(
          "id, code, envio_id, cliente_id, cliente_email, comprador_alias, ticket_id, evento, sector, fecha_evento, cantidad, moneda, notas, estado, operacion_id, resuelta_por, resuelta_at, created_at, updated_at, cotizacion_monto, cotizacion_fee, cotizacion_version, cotizada_at, cotizada_por, cotizada_por_admin, vence_at"
        )
        .in("estado", ["pendiente", "cotizada"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    consultas = (pendientes.data ?? []) as Consulta[];
    ops = (recentes.data ?? []).map((o) => ({
      ...o,
      notas: null,
      cuenta_debitar: null,
      cliente_id: null,
    })) as Operacion[];
    metrics = metricasDominantes((agregados.data ?? []) as any[]);

  }

  return (
    // El moderador puro tiene una sola sección: sin navegación ni padding.
    <main className={`min-h-svh ${esAdmin ? "pb-16 md:pb-10" : ""}`}>
      <AppHeader subtitle="Carga de operaciones" email={email} nav={esAdmin} />
      <ModeradorDashboard
        initial={ops}
        consultas={consultas}
        metrics={metrics}
        baseUrl={getBaseUrl()}
        // Las tarjetas de plata abren el Panel filtrado: solo el admin entra ahí.
        enlacesPanel={esAdmin}
        // El moderador no tiene barra de secciones: Clientes va como link.
        enlaceClientes={!esAdmin}
        prefill={
          searchParams?.evento || searchParams?.ticket
            ? { evento: searchParams.evento, ticketId: searchParams.ticket }
            : undefined
        }
      />
      <AutoRefresh intervalMs={20000} versionUrl="/api/operaciones/version" />
      {esAdmin && <BottomNav />}
    </main>
  );
}
