import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { sesionVerificada } from "@/lib/usuario-verificado";
import { versionMisPedidos } from "@/lib/mis-pedidos-version";
import { miembroDe } from "@/lib/organizaciones-db";
import {
  isMock,
  mockFacturaDeOperacion,
  mockGetTextosPago,
  mockListConsultasCliente,
  mockListPedidosCliente,
  mockMiembroDe,
  MOCK_USER,
} from "@/lib/mock-db";

// GET /api/mis-pedidos/version — { v } que cambia solo si cambió algo de los
// pedidos del cliente logueado (ver lib/mis-pedidos-version.ts). "Mis pedidos"
// lo consulta cada 20 s y solo se re-renderiza cuando cambió.
export const dynamic = "force-dynamic";

export async function GET() {
  if (isMock()) {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const miembro = mockMiembroDe(id);
    const orgVisible = miembro?.rol === "admin" ? miembro.organizacion_id : null;
    const ops = mockListPedidosCliente(id, MOCK_USER.email, orgVisible);
    const textos = mockGetTextosPago();
    return NextResponse.json({
      v: versionMisPedidos({
        ops,
        consultas: mockListConsultasCliente(id, MOCK_USER.email, orgVisible).map((c) => ({
          updated_at: c.updated_at,
          estado: c.estado,
          vence_at: (c as { vence_at?: string | null }).vence_at ?? null,
        })),
        facturas: ops.filter((o) => mockFacturaDeOperacion(o.id)).length,
        // El mock no guarda fecha de los textos: el contenido hace de versión.
        textos: Object.entries(textos).map(([k, v]) => ({ updated_at: `${k}=${v}` })),
      }),
    });
  }

  const { user, authCaido } = await sesionVerificada();
  // Auth no contestó: 503 para que Mis pedidos reintente (un 401 la daría por
  // deslogueada y dejaría de actualizarse).
  if (authCaido) return NextResponse.json({ error: "Auth no disponible" }, { status: 503 });
  if (!user || !puedeVerTienda(getRol(user))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Lo suyo, con service role y filtrado por su cliente_id (las tablas son
  // deny-all para el cliente). Mismos topes y mismo alcance que la página:
  // el administrador de una organización también sigue los de sus
  // vendedores (TKT-10); si no, su pantalla no se enteraba de esos cambios.
  const admin = createAdminSupabase();
  const miembro = await miembroDe(admin, user.id).catch(() => null);
  const orgVisible = miembro?.rol === "admin" ? miembro.organizacion_id : null;
  const deQuien = orgVisible
    ? `cliente_id.eq.${user.id},organizacion_id.eq.${orgVisible}`
    : `cliente_id.eq.${user.id}`;
  const [ops, consultas, textos] = await Promise.all([
    admin.from("operaciones").select("id, updated_at").or(deQuien).limit(200),
    admin
      .from("consultas")
      .select("updated_at, estado, vence_at")
      .or(deQuien)
      .limit(200),
    admin.from("textos_config").select("updated_at").like("key", "pago_%"),
  ]);
  if (ops.error || consultas.error || textos.error) {
    return NextResponse.json({ error: "No se pudo leer" }, { status: 500 });
  }
  const ids = (ops.data ?? []).map((o) => o.id as string);
  let facturas = 0;
  if (ids.length) {
    const { count, error } = await admin
      .from("facturas")
      .select("id", { count: "exact", head: true })
      .in("operacion_id", ids);
    if (error) return NextResponse.json({ error: "No se pudo leer" }, { status: 500 });
    facturas = count ?? 0;
  }

  return NextResponse.json({
    v: versionMisPedidos({
      ops: ops.data ?? [],
      consultas: consultas.data ?? [],
      facturas,
      textos: textos.data ?? [],
    }),
  });
}
