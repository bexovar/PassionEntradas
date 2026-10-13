// "Base de datos" en memoria para desarrollo sin Supabase (MOCK_DATA=1).
// Vive en globalThis para sobrevivir al hot-reload del dev server; se
// resetea al reiniciar el proceso. NO usar en producción.

import { avisoDeSobreventa, movimientoDeStock, type LineaDescontada } from "@/lib/stock";
import {
  bloqueoEnAccesos,
  listarMiembros,
  mapaEquipo,
  metadataDeCambio,
  registroDeCambio,
  validarCambioEquipo,
  type CambioEquipo,
  type RegistroEquipo,
  type RolEquipo,
} from "@/lib/equipo";
import {
  generateCode,
  type Consulta,
  type Moneda,
  type Operacion,
  type OperacionItem,
  type OperacionPublica,
  type StatusAction,
  operacionCompleta,
  clientePuedeCancelar,
} from "@/lib/operaciones";
import type { SyncRun, TicketFull } from "@/lib/tickets";
import type { Factura, FacturaDatos } from "@/lib/factura";
import { generarPassword, type SolicitudAcceso, type SolicitudInput } from "@/lib/acceso";
import { MOCK_TICKETS } from "@/lib/mock-tickets";
import type { AvisoGuardado, NuevoAviso } from "@/lib/avisos";

export type MockFactura = Factura & { operacion_id: string };

export const isMock = () => process.env.MOCK_DATA === "1";

export const MOCK_USER = {
  // Id del admin demo en la "Auth" de mentira (ver `usuarios`).
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@passion.local",
  rol: "administrador" as const,
  // Perfil del cliente demo: el legajo viaja igual que en producción
  // (solicitud -> cuenta -> pedido -> factura) para poder verlo sin Supabase.
  legajo: "20-31222333-9",
};

export type MockMargen = {
  id: string;
  source: string;
  competicion: string | null;
  porcentaje: number;
};

type MockDB = {
  ops: Operacion[];
  manual: TicketFull[];
  syncRuns: SyncRun[];
  margenes: MockMargen[];
  eurUsd: number;
  arsPorUsd: number | null;
  portalActivo: boolean;
  facturas: MockFactura[];
  facturaNumero: number;
  solicitudes: SolicitudAcceso[];
  items: OperacionItem[];
  consultas: Consulta[];
  // Textos de pago por moneda (espejo de textos_config).
  textos: Record<string, string>;
  // Plazo para aceptar una cotización (config.cotizacion_vence_horas).
  venceHoras: number;
  // Usuarios del equipo (espejo de Auth: app_metadata.role / desactivado).
  usuarios: MockUsuario[];
  equipoCambios: (RegistroEquipo & { id: string; created_at: string })[];
  // Espejo de la tabla notificaciones.
  avisos: AvisoGuardado[];
};

export type MockUsuario = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  last_sign_in_at: string | null;
};

function iso(minsAgo: number) {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

function seed(): MockDB {
  const ops: Operacion[] = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      code: "BX-DEMOPAGO",
      evento: "Boca vs Vasco da Gama",
      comprador_alias: "demo",
      vendedor_alias: null,
      monto: 1200000,
      moneda: "ARS",
      cantidad: 2,
      fee: 420000,
      status: "esperando_entrada",
      entrada_recibida_at: iso(30),
      pago_confirmado_at: null,
      pago_proveedor_at: null,
      cerrada_at: null,
      entrada_recibida_por: MOCK_USER.email,
      pago_confirmado_por: null,
      pago_proveedor_por: null,
      cerrada_por: null,
      confirmada_at: iso(60 * 2),
      confirmada_por: MOCK_USER.email,
      fecha_evento: null,
      notas: null,
      cuenta_debitar: null,
      ticket_id: "manual::demo-ars",
      tipo: "pedido",
      cliente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      cliente_email: "demo@passion.local",
      sector: "Platea Baja",
      created_at: iso(60 * 5),
      updated_at: iso(30),
    },
    {
      id: "11111111-1111-4111-8111-111111111111",
      code: "BX-DEMO1234",
      evento: "Real Madrid vs Manchester City",
      comprador_alias: "compra_marce",
      vendedor_alias: "vende_lucho",
      monto: 850000,
      moneda: "USD",
      cantidad: 1,
      fee: 60000,
      status: "entrada_recibida",
      entrada_recibida_at: iso(90),
      pago_confirmado_at: null,
      pago_proveedor_at: null,
      cerrada_at: null,
      entrada_recibida_por: MOCK_USER.email,
      pago_confirmado_por: null,
      pago_proveedor_por: null,
      cerrada_por: null,
      fecha_evento: "2026-07-18",
      notas: "Vendedor manda el QR el jueves.",
      cuenta_debitar: "admintickets.mp",
      ticket_id: "3001::1",
      tipo: "operacion",
      cliente_id: null,
      cliente_email: null,
      sector: null,
      created_at: iso(60 * 26),
      updated_at: iso(90),
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      code: "BX-DEMO5678",
      evento: "River vs Boca - Superclásico",
      comprador_alias: "juanma_ok",
      vendedor_alias: null,
      monto: 300000,
      moneda: "USD",
      cantidad: 2,
      fee: 25000,
      status: "esperando_entrada",
      entrada_recibida_at: null,
      pago_confirmado_at: null,
      pago_proveedor_at: null,
      cerrada_at: null,
      entrada_recibida_por: null,
      pago_confirmado_por: null,
      pago_proveedor_por: null,
      cerrada_por: null,
      fecha_evento: "2026-07-09",
      notas: null,
      cuenta_debitar: null,
      ticket_id: "manual::demo-1",
      // Pedido de un cliente desde la tienda (para la vista "Mis pedidos").
      tipo: "pedido",
      cliente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      cliente_email: "demo@passion.local",
      sector: "Platea Media",
      created_at: iso(60 * 3),
      updated_at: iso(60 * 3),
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      code: "BX-DEMO9ABC",
      evento: "Formula 1 - Gran Premio de Monza",
      comprador_alias: "f1fan",
      vendedor_alias: "scuderia_ar",
      monto: 500000,
      moneda: "USD",
      cantidad: 1,
      fee: 40000,
      status: "confirmada",
      entrada_recibida_at: iso(60 * 24 * 3),
      pago_confirmado_at: iso(60 * 24 * 2),
      pago_proveedor_at: null,
      cerrada_at: null,
      entrada_recibida_por: MOCK_USER.email,
      pago_confirmado_por: MOCK_USER.email,
      pago_proveedor_por: null,
      cerrada_por: null,
      fecha_evento: null,
      notas: null,
      cuenta_debitar: null,
      ticket_id: null,
      tipo: "operacion",
      cliente_id: null,
      cliente_email: null,
      sector: null,
      created_at: iso(60 * 24 * 4),
      updated_at: iso(60 * 24 * 2),
    },
  ];

  const manual: TicketFull[] = MOCK_TICKETS.filter((t) => t.source === "manual").map((t) => ({
    ...t,
    precio_origen: t.precio_final,
    moneda_origen: t.moneda_final ?? "USD",
    moneda_final: t.precio_final != null ? t.moneda_final ?? "USD" : null,
    disponible: (t.stock ?? 0) > 0,
    url_origen: null,
    scraped_at: iso(60),
    updated_at: iso(60),
  }));

  const syncRuns: SyncRun[] = [
    { id: 5, status: "ok", reason: null, scraped_valid: 132, upserted: 12, marked_unavailable: 1, complete: true, duration_ms: 48000, created_at: iso(7) },
    { id: 4, status: "ok", reason: null, scraped_valid: 131, upserted: 3, marked_unavailable: 0, complete: true, duration_ms: 45120, created_at: iso(22) },
    { id: 3, status: "aborted", reason: "caída de items > 70%", scraped_valid: 12, upserted: 0, marked_unavailable: 0, complete: false, duration_ms: 9800, created_at: iso(37) },
    { id: 2, status: "ok", reason: null, scraped_valid: 130, upserted: 8, marked_unavailable: 2, complete: true, duration_ms: 51000, created_at: iso(52) },
    { id: 1, status: "ok", reason: null, scraped_valid: 129, upserted: 129, marked_unavailable: 0, complete: true, duration_ms: 62000, created_at: iso(67) },
  ];

  const margenes: MockMargen[] = [
    { id: "m-default", source: "portal", competicion: null, porcentaje: 20 },
    { id: "m-mundial", source: "portal", competicion: "World Cup 2026 Canada / Mexico / USA", porcentaje: 35 },
  ];

  const solicitudes: SolicitudAcceso[] = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      nombre: "Lucía Fernández",
      email: "lucia.fernandez@example.com",
      telefono: "+54 9 11 5555 1234",
      legajo: "27-35123456-4",
      direccion: "Av. Corrientes 1234, CABA",
      mensaje: "Busco entradas para la final del Mundial 2026.",
      estado: "pendiente",
      user_id: null,
      decidida_por: null,
      decidida_at: null,
      revocada_at: null,
      revocada_por: null,
      acepto_terminos: true,
      created_at: iso(40),
      updated_at: iso(40),
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      nombre: "Diego Sosa",
      email: "diego.sosa@example.com",
      telefono: "+54 9 351 444 7788",
      legajo: "20-28999111-7",
      direccion: "Bv. San Juan 500, Córdoba",
      mensaje: null,
      estado: "aprobada",
      user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      decidida_por: MOCK_USER.email,
      decidida_at: iso(60 * 20),
      revocada_at: null,
      revocada_por: null,
      acepto_terminos: true,
      created_at: iso(60 * 22),
      updated_at: iso(60 * 20),
    },
    {
      // Era cliente y pasó al equipo (ver `equipo` más abajo).
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      nombre: "Emilia Demo",
      email: "emilia.demo@example.com",
      telefono: "+54 9 351 555 0000",
      legajo: null,
      direccion: null,
      mensaje: null,
      estado: "aprobada",
      user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      decidida_por: MOCK_USER.email,
      decidida_at: iso(60 * 40),
      revocada_at: null,
      revocada_por: null,
      acepto_terminos: true,
      created_at: iso(60 * 42),
      updated_at: iso(60 * 40),
    },
  ];

  return {
    ops,
    manual,
    syncRuns,
    margenes,
    eurUsd: 1.08,
    arsPorUsd: null,
    portalActivo: true,
    facturas: [],
    facturaNumero: 0,
    solicitudes,
    usuarios: [
      {
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        app_metadata: { role: "administrador" },
        user_metadata: { nombre: "Demo", apellido: "Admin" },
        last_sign_in_at: iso(10),
      },
      {
        // Era cliente (solicitud dddd…) y pasó al equipo.
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        email: "emilia.demo@example.com",
        app_metadata: { role: "administrador" },
        user_metadata: { nombre: "Emilia", apellido: "Demo", telefono: "+54 9 351 555 0000" },
        last_sign_in_at: iso(60 * 26),
      },
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        email: "lucho.demo@example.com",
        app_metadata: { role: "moderador" },
        user_metadata: { nombre: "Lucho" },
        last_sign_in_at: null,
      },
    ],
    equipoCambios: [],
    avisos: [],
    items: [],
    // Consultas del cliente demo: una para cotizar y una ya cotizada que
    // espera su respuesta (se ve en el panel y en Mis pedidos).
    consultas: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        code: "BX-DEMOCONS",
        envio_id: null,
        cliente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        cliente_email: "demo@passion.local",
        comprador_alias: "demo",
        ticket_id: null,
        evento: "Final Copa Libertadores 2026",
        sector: "Platea",
        fecha_evento: null,
        cantidad: 2,
        moneda: "USD",
        notas: null,
        estado: "pendiente",
        operacion_id: null,
        resuelta_por: null,
        resuelta_at: null,
        created_at: iso(60),
        updated_at: iso(60),
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        code: "BX-DEMOCOTI",
        envio_id: null,
        cliente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        cliente_email: "demo@passion.local",
        comprador_alias: "demo",
        ticket_id: null,
        evento: "Argentina vs Brasil - Eliminatorias",
        sector: "Popular",
        fecha_evento: null,
        cantidad: 1,
        moneda: "USD",
        notas: null,
        estado: "cotizada",
        cotizacion_monto: 450,
        cotizacion_fee: 70,
        cotizacion_version: 1,
        cotizada_at: iso(60),
        cotizada_por: MOCK_USER.email,
        cotizada_por_admin: true,
        vence_at: new Date(Date.now() + 47 * 3600_000).toISOString(),
        operacion_id: null,
        resuelta_por: null,
        resuelta_at: null,
        created_at: iso(120),
        updated_at: iso(60),
      },
    ],
    textos: {
      pago_ARS: "Transferencia a alias PASSION.ENTRADAS (Banco Demo). Mandanos el comprobante por WhatsApp.",
      pago_USD: "Pago en dólares: transferencia o efectivo. Escribinos por WhatsApp y te pasamos los datos.",
    },
    venceHoras: 48,
  };
}

function db(): MockDB {
  const g = globalThis as typeof globalThis & { __passionMockDb?: MockDB };
  if (!g.__passionMockDb) g.__passionMockDb = seed();
  return g.__passionMockDb;
}

// ---- operaciones ---------------------------------------------------------------
export function mockListOps(limit?: number): Operacion[] {
  const out = [...db().ops].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return limit ? out.slice(0, limit) : out;
}

export function mockOpPublica(id: string): OperacionPublica | null {
  const op = db().ops.find((o) => o.id === id);
  if (!op) return null;
  const { code, evento, comprador_alias, vendedor_alias, monto, moneda, status, entrada_recibida_at, pago_confirmado_at, cerrada_at, fecha_evento, updated_at, tipo, confirmada_at } = op;
  return { code, evento, comprador_alias, vendedor_alias, monto, moneda, status, entrada_recibida_at, pago_confirmado_at, cerrada_at, fecha_evento, updated_at, tipo, confirmada_at: confirmada_at ?? null };
}

export function mockCreateOp(input: {
  evento: string;
  comprador_alias: string | null;
  vendedor_alias: string | null;
  monto: number;
  fee: number;
  ticket_id: string | null;
  fecha_evento: string | null;
  notas: string | null;
  cuenta_debitar: string | null;
  tipo?: Operacion["tipo"];
  cliente_id?: string | null;
  cliente_email?: string | null;
  sector?: string | null;
  cantidad?: number;
  moneda?: Moneda;
  envio_id?: string | null;
  confirmada_at?: string | null;
  confirmada_por?: string | null;
  idioma?: "es" | "en" | null;
  // Líneas del pedido: se guardan aparte, igual que en la base.
  items?: Omit<OperacionItem, "id" | "operacion_id" | "created_at">[];
}): Operacion {
  const now = new Date().toISOString();
  const { items: lineas, ...campos } = input;
  const op: Operacion = {
    id: crypto.randomUUID(),
    code: generateCode(),
    ...campos,
    cantidad: input.cantidad ?? 1,
    moneda: input.moneda ?? "USD",
    tipo: input.tipo ?? "operacion",
    cliente_id: input.cliente_id ?? null,
    cliente_email: input.cliente_email ?? null,
    sector: input.sector ?? null,
    status: "esperando_entrada",
    entrada_recibida_at: null,
    pago_confirmado_at: null,
    pago_proveedor_at: null,
    cerrada_at: null,
    entrada_recibida_por: null,
    pago_confirmado_por: null,
    pago_proveedor_por: null,
    cerrada_por: null,
    confirmada_at: input.confirmada_at ?? null,
    confirmada_por: input.confirmada_por ?? null,
    cancelada_at: null,
    cancelada_por: null,
    created_at: now,
    updated_at: now,
  };
  const d = db();
  d.ops.unshift(op);
  for (const l of lineas ?? []) {
    d.items.push({ id: crypto.randomUUID(), operacion_id: op.id, created_at: now, ...l });
  }
  return op;
}

// "Mis pedidos" del cliente: pedidos/consultas que originó (por cliente_id, o
// por email cuando no hay id de usuario en mock). Más nuevos primero.
export function mockListPedidosCliente(clienteId: string | null, email: string | null): Operacion[] {
  return db()
    .ops.filter(
      (o) =>
        ((clienteId && o.cliente_id === clienteId) ||
          (email && o.cliente_email?.toLowerCase() === email.toLowerCase()))
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockApplyAction(
  id: string,
  action: StatusAction
): { ok: true; op: Operacion; aviso?: string | null } | { ok: false; status: number; error: string } {
  const op = db().ops.find((o) => o.id === id);
  if (!op) return { ok: false, status: 404, error: "Operación no encontrada" };
  const cancelada = op.status === "cancelada";
  const antes = { status: op.status, pago_confirmado_at: op.pago_confirmado_at, confirmada_at: op.confirmada_at ?? null };

  switch (action.action) {
    case "entrada":
    case "pago":
    case "proveedor": {
      if (cancelada) {
        return { ok: false, status: 409, error: "La operación está cancelada; reabrila para editar hitos" };
      }
      // Espejo de la API: congela recién con los cuatro hechos.
      if (operacionCompleta(op)) {
        return {
          ok: false,
          status: 409,
          error: "La operación está completa; desmarcá un hito para volver a editarla",
        };
      }
      // Sin orden: espejo de la API y del trigger, que ya no lo imponen.
      const COLS = {
        entrada: ["entrada_recibida_at", "entrada_recibida_por"],
        pago: ["pago_confirmado_at", "pago_confirmado_por"],
        proveedor: ["pago_proveedor_at", "pago_proveedor_por"],
      } as const;
      const [col, colPor] = COLS[action.action];
      op[col] = action.done ? new Date().toISOString() : null;
      op[colPor] = action.done ? MOCK_USER.email : null;
      // Espejo de la API: trabajar un pedido nuevo es confirmarlo.
      if (action.done && !op.confirmada_at) {
        op.confirmada_at = new Date().toISOString();
        op.confirmada_por = MOCK_USER.email;
      }
      break;
    }
    case "confirmar":
      if (cancelada) return { ok: false, status: 409, error: "La operación está cancelada; reabrila para confirmarla" };
      if (op.confirmada_at) return { ok: false, status: 409, error: "El pedido ya está confirmado" };
      op.confirmada_at = new Date().toISOString();
      op.confirmada_por = MOCK_USER.email;
      break;
    case "cerrar":
      if (cancelada) return { ok: false, status: 409, error: "La operación está cancelada; no se puede cerrar" };
      op.cerrada_at = action.done ? new Date().toISOString() : null;
      op.cerrada_por = action.done ? MOCK_USER.email : null;
      if (action.done && !op.confirmada_at) {
        op.confirmada_at = new Date().toISOString();
        op.confirmada_por = MOCK_USER.email;
      }
      // Entregar ya no mueve stock: se descuenta al pagar (ver lib/stock.ts).
      break;
    case "cancelar":
      if (cancelada) return { ok: false, status: 409, error: "La operación ya está cancelada" };
      if (op.cerrada_at) {
        return { ok: false, status: 409, error: "La operación está cerrada; reabrí el cierre antes de cancelar" };
      }
      op.status = "cancelada";
      op.cancelada_at = new Date().toISOString();
      op.cancelada_por = MOCK_USER.email;
      break;
    case "reabrir":
      if (!cancelada) return { ok: false, status: 409, error: "Solo se puede reabrir una operación cancelada" };
      op.status = "esperando_entrada";
      op.cancelada_at = null;
      op.cancelada_por = null;
      break;
  }
  op.updated_at = new Date().toISOString();
  // Stock: espejo de la función stock_operacion de la base.
  const mov = movimientoDeStock(action, antes, op);
  const aviso = mov ? mockStockOperacion(op, mov === "tomar") : null;
  return { ok: true, op, aviso };
}

// Espejo de stock_operacion (migración 0039): toma por línea y cantidad, nunca
// negativo, registra lo tomado en la operación y devuelve exactamente eso.
function mockStockOperacion(op: Operacion, tomar: boolean): string | null {
  const reg = op as Operacion & { stock_descontado?: LineaDescontada[] };
  const tomado = reg.stock_descontado ?? [];
  if (!tomar) {
    for (const l of tomado) mockAjustarStockManual(l.ticket_id, l.cantidad);
    reg.stock_descontado = [];
    return null;
  }
  if (tomado.length > 0) return null;
  const items = db().items.filter((i) => i.operacion_id === op.id);
  const porTicket = new Map<string, number>();
  const lineas = items.length
    ? items.map((i) => ({ ticket_id: i.ticket_id, cantidad: i.cantidad }))
    : [{ ticket_id: op.ticket_id, cantidad: op.cantidad || 1 }];
  for (const l of lineas) {
    if (l.ticket_id?.startsWith("manual::")) {
      porTicket.set(l.ticket_id, (porTicket.get(l.ticket_id) ?? 0) + l.cantidad);
    }
  }
  const res: LineaDescontada[] = [];
  for (const [ticket_id, pedido] of Array.from(porTicket.entries())) {
    const t = db().manual.find((m) => m.id === ticket_id);
    if (!t) continue;
    const cantidad = Math.min(Math.max(t.stock ?? 0, 0), pedido);
    mockAjustarStockManual(ticket_id, -cantidad);
    res.push({ ticket_id, cantidad, pedido });
  }
  reg.stock_descontado = res;
  return avisoDeSobreventa(res);
}

export function mockUpdateOp(
  id: string,
  patch: Partial<Pick<Operacion, "notas" | "fecha_evento">>
): { ok: true; op: Operacion } | { ok: false; status: number; error: string } {
  const op = db().ops.find((o) => o.id === id);
  if (!op) return { ok: false, status: 404, error: "Operación no encontrada" };
  if ("notas" in patch) op.notas = patch.notas ?? null;
  if ("fecha_evento" in patch) op.fecha_evento = patch.fecha_evento ?? null;
  op.updated_at = new Date().toISOString();
  return { ok: true, op };
}

// ---- tickets manuales ------------------------------------------------------------
export function mockListManual(): TicketFull[] {
  return [...db().manual];
}

export function mockCreateManual(row: TicketFull): TicketFull {
  db().manual.unshift(row);
  return row;
}

export function mockUpdateManual(
  id: string,
  patch: Partial<TicketFull>
): TicketFull | null {
  const t = db().manual.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: new Date().toISOString() });
  return t;
}

// Descuento/reposición de stock de una entrada propia (operación vinculada
// cerrada/reabierta). Clampa en 0.
export function mockAjustarStockManual(ticketId: string, delta: number): void {
  const t = db().manual.find((x) => x.id === ticketId);
  if (!t) return;
  t.stock = Math.max(0, (t.stock ?? 0) + delta);
  t.disponible = (t.stock ?? 0) > 0;
  t.updated_at = new Date().toISOString();
}

export function mockDeleteManual(id: string): boolean {
  const d = db();
  const before = d.manual.length;
  d.manual = d.manual.filter((t) => t.id !== id);
  return d.manual.length < before;
}

// ---- worker ----------------------------------------------------------------------
export function mockSyncRuns(): SyncRun[] {
  return [...db().syncRuns];
}

export function mockPortalCount(): number {
  return MOCK_TICKETS.filter((t) => t.source === "portal").length;
}

// ---- margenes ---------------------------------------------------------------------
export function mockListMargenes(): MockMargen[] {
  return [...db().margenes].sort((a, b) =>
    (a.competicion ?? "").localeCompare(b.competicion ?? "")
  );
}

export function mockUpsertMargen(competicion: string | null, porcentaje: number): MockMargen {
  const d = db();
  const existente = d.margenes.find((m) => m.competicion === competicion);
  if (existente) {
    existente.porcentaje = porcentaje;
    return existente;
  }
  const nuevo: MockMargen = { id: crypto.randomUUID(), source: "portal", competicion, porcentaje };
  d.margenes.push(nuevo);
  return nuevo;
}

export function mockDeleteMargen(competicion: string): boolean {
  const d = db();
  const antes = d.margenes.length;
  d.margenes = d.margenes.filter((m) => m.competicion !== competicion);
  return d.margenes.length < antes;
}

// ---- facturas -----------------------------------------------------------------------
export function mockFacturaDeOperacion(opId: string): MockFactura | null {
  return db().facturas.find((f) => f.operacion_id === opId) ?? null;
}

export function mockFacturaPorId(id: string): MockFactura | null {
  return db().facturas.find((f) => f.id === id) ?? null;
}

export function mockGuardarFactura(opId: string, datos: FacturaDatos): MockFactura {
  const d = db();
  const existente = d.facturas.find((f) => f.operacion_id === opId);
  if (existente) {
    // Re-emitir: nuevo snapshot, mismo numero/id/fecha (como el upsert real).
    existente.datos = datos;
    return existente;
  }
  const nueva: MockFactura = {
    id: crypto.randomUUID(),
    numero: ++d.facturaNumero,
    operacion_id: opId,
    datos,
    created_at: new Date().toISOString(),
  };
  d.facturas.push(nueva);
  return nueva;
}

// ---- cotización EUR->USD ------------------------------------------------------------
export function mockGetEurUsd(): number {
  return db().eurUsd;
}

export function mockGetArsPorUsd(): number | null {
  return db().arsPorUsd ?? null;
}

export function mockSetArsPorUsd(v: number | null): number | null {
  db().arsPorUsd = v;
  return v;
}

export function mockSetEurUsd(v: number): number {
  db().eurUsd = v;
  return v;
}

// ---- interruptor de entradas de Passion ---------------------------------------------
export function mockGetPortalActivo(): boolean {
  return db().portalActivo;
}

export function mockSetPortalActivo(v: boolean): boolean {
  db().portalActivo = v;
  return v;
}

// ---- solicitudes de acceso (landing) ------------------------------------------------
// Crea una solicitud. Una PENDIENTE por email (idempotente: si ya hay una
// pendiente devuelve ok sin duplicar, igual que el unique index real).
export function mockCrearSolicitud(input: SolicitudInput): { ok: true } | { ok: false; error: string } {
  const d = db();
  const yaPendiente = d.solicitudes.some(
    (s) => s.estado === "pendiente" && s.email.toLowerCase() === input.email.toLowerCase()
  );
  if (yaPendiente) return { ok: true };
  const now = new Date().toISOString();
  d.solicitudes.unshift({
    id: crypto.randomUUID(),
    nombre: input.nombre,
    email: input.email,
    telefono: input.telefono,
    legajo: input.legajo,
    direccion: null,
    mensaje: input.mensaje,
    estado: "pendiente",
    user_id: null,
    decidida_por: null,
    decidida_at: null,
    revocada_at: null,
    revocada_por: null,
    acepto_terminos: input.acepto,
    created_at: now,
    updated_at: now,
  });
  return { ok: true };
}

// Lista para el panel: pendientes primero, luego por fecha (más nuevas arriba).
export function mockEquipo(): Map<string, "administrador" | "moderador"> {
  return mapaEquipo(db().usuarios);
}

// ---- equipo (pantalla Equipo) ----------------------------------------------
export function mockListUsuarios(): MockUsuario[] {
  return db().usuarios;
}

export function mockListCambiosEquipo() {
  return [...db().equipoCambios].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
}

function mockRegistrar(r: RegistroEquipo) {
  db().equipoCambios.push({ ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() });
}

// Alta en el equipo: usuario nuevo con contraseña temporal, o un cliente que
// ya tiene cuenta y pasa al equipo (`promover`).
export function mockAltaEquipo(
  input: { email: string; nombre: string; apellido: string; rol: RolEquipo; promover: boolean },
  por: string
):
  | { ok: true; id: string; credenciales: { email: string; password: string } | null }
  | { ok: false; status: number; error: string; esCliente?: boolean } {
  const d = db();
  const email = input.email.toLowerCase();
  const existente =
    d.usuarios.find((u) => u.email.toLowerCase() === email) ??
    // Los clientes del demo viven en las solicitudes aprobadas.
    (() => {
      const s = d.solicitudes.find((x) => x.email.toLowerCase() === email && x.estado === "aprobada" && x.user_id);
      if (!s) return undefined;
      const u: MockUsuario = {
        id: s.user_id as string,
        email: s.email,
        app_metadata: { role: "cliente" },
        user_metadata: { nombre: s.nombre },
        last_sign_in_at: null,
      };
      return u;
    })();
  if (existente) {
    const rol = existente.app_metadata.role;
    if (rol === "administrador" || rol === "moderador") {
      return { ok: false, status: 409, error: "Ya es parte del equipo." };
    }
    if (!input.promover) {
      return { ok: false, status: 409, error: "Ya tiene cuenta de cliente.", esCliente: true };
    }
    existente.app_metadata = { ...existente.app_metadata, role: input.rol, desactivado: false };
    if (!d.usuarios.includes(existente)) d.usuarios.push(existente);
    mockRegistrar({ user_id: existente.id, email: existente.email, accion: "alta", rol_antes: "cliente", rol_despues: input.rol, por });
    return { ok: true, id: existente.id, credenciales: null };
  }
  const id = crypto.randomUUID();
  d.usuarios.push({
    id,
    email: input.email,
    app_metadata: { role: input.rol },
    user_metadata: { nombre: input.nombre, apellido: input.apellido },
    last_sign_in_at: null,
  });
  mockRegistrar({ user_id: id, email: input.email, accion: "alta", rol_antes: null, rol_despues: input.rol, por });
  return { ok: true, id, credenciales: { email: input.email, password: generarPassword() } };
}

export function mockCambioEquipo(
  id: string,
  cambio: CambioEquipo,
  actorId: string,
  por: string
): { ok: true } | { ok: false; status: number; error: string } {
  const d = db();
  const equipo = listarMiembros(d.usuarios);
  const objetivo = equipo.find((m) => m.id === id);
  if (!objetivo) return { ok: false, status: 404, error: "No es parte del equipo." };
  const error = validarCambioEquipo(actorId, objetivo, cambio, equipo);
  if (error) return { ok: false, status: 409, error };
  const u = d.usuarios.find((x) => x.id === id)!;
  u.app_metadata = { ...u.app_metadata, ...metadataDeCambio(cambio) };
  const registro = registroDeCambio(objetivo, cambio, por);
  if (registro) mockRegistrar(registro);
  return { ok: true };
}

export function mockListSolicitudes(): SolicitudAcceso[] {
  return [...db().solicitudes].sort((a, b) => {
    if (a.estado !== b.estado) {
      if (a.estado === "pendiente") return -1;
      if (b.estado === "pendiente") return 1;
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

// Aprueba/rechaza una solicitud pendiente. Al aprobar "crea" un usuario
// (user_id ficticio) y devuelve las credenciales para mostrarlas una vez.
export function mockDecidirSolicitud(
  id: string,
  accion: "aprobar" | "rechazar",
  decididaPor: string
):
  | { ok: true; solicitud: SolicitudAcceso; credenciales?: { email: string; password: string } }
  | { ok: false; status: number; error: string } {
  const s = db().solicitudes.find((x) => x.id === id);
  if (!s) return { ok: false, status: 404, error: "Solicitud no encontrada" };
  if (s.estado !== "pendiente") {
    return { ok: false, status: 409, error: "La solicitud ya fue resuelta" };
  }
  const now = new Date().toISOString();
  s.decidida_por = decididaPor;
  s.decidida_at = now;
  s.updated_at = now;
  if (accion === "rechazar") {
    s.estado = "rechazada";
    return { ok: true, solicitud: s };
  }
  const password = generarPassword();
  s.estado = "aprobada";
  s.user_id = crypto.randomUUID();
  return { ok: true, solicitud: s, credenciales: { email: s.email, password } };
}

// Reenvía el acceso de una solicitud YA aprobada: regenera la contraseña
// (la anterior no se guarda) y devuelve las credenciales nuevas.
export function mockReenviarSolicitud(
  id: string
):
  | { ok: true; solicitud: SolicitudAcceso; credenciales: { email: string; password: string } }
  | { ok: false; status: number; error: string } {
  const s = db().solicitudes.find((x) => x.id === id);
  if (!s) return { ok: false, status: 404, error: "Solicitud no encontrada" };
  if (s.estado !== "aprobada") {
    return { ok: false, status: 409, error: "Solo se reenvía el acceso de una solicitud aprobada" };
  }
  const bloqueo = bloqueoEnAccesos(s.user_id ? mockEquipo().get(s.user_id) ?? null : null, "reenviar");
  if (bloqueo) return { ok: false, status: 409, error: bloqueo };
  const password = generarPassword();
  return { ok: true, solicitud: s, credenciales: { email: s.email, password } };
}

// Revoca/reactiva el acceso de una solicitud aprobada.
export function mockRevocarSolicitud(
  id: string,
  accion: "revocar" | "reactivar",
  quien: string
): { ok: true; solicitud: SolicitudAcceso } | { ok: false; status: number; error: string } {
  const s = db().solicitudes.find((x) => x.id === id);
  if (!s) return { ok: false, status: 404, error: "Solicitud no encontrada" };
  if (s.estado !== "aprobada") {
    return { ok: false, status: 409, error: "Solo se revoca el acceso de una solicitud aprobada" };
  }
  const bloqueo = bloqueoEnAccesos(s.user_id ? mockEquipo().get(s.user_id) ?? null : null, accion);
  if (bloqueo) return { ok: false, status: 409, error: bloqueo };
  if (accion === "revocar") {
    if (s.revocada_at) return { ok: false, status: 409, error: "El acceso ya está revocado" };
    s.revocada_at = new Date().toISOString();
    s.revocada_por = quien;
  } else {
    if (!s.revocada_at) return { ok: false, status: 409, error: "El acceso no está revocado" };
    s.revocada_at = null;
    s.revocada_por = null;
  }
  s.updated_at = new Date().toISOString();
  return { ok: true, solicitud: s };
}


// --- líneas de la operación y consultas (espejo de las tablas nuevas) -------
export function mockListItems(operacionId: string): OperacionItem[] {
  return db().items.filter((i) => i.operacion_id === operacionId);
}

export function mockListConsultas(): Consulta[] {
  return db().consultas;
}

// Consultas del cliente que no son (todavía) una operación: las pendientes, las
// cotizadas (esperando su respuesta) y las canceladas/descartadas/rechazadas de
// los últimos 30 días. Las convertidas ya se ven
// como la operación que originaron; mostrarlas otra vez duplicaría el pedido.
export function mockListConsultasCliente(
  clienteId: string | null,
  email: string | null
): Consulta[] {
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  return db()
    .consultas.filter(
      (c) =>
        (c.estado === "pendiente" ||
          c.estado === "cotizada" ||
          ((c.estado === "cancelada" || c.estado === "descartada" || c.estado === "rechazada") &&
            c.updated_at >= desde)) &&
        ((clienteId && c.cliente_id === clienteId) ||
          (email && c.cliente_email?.toLowerCase() === email.toLowerCase()))
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockCrearConsulta(input: {
  envio_id: string | null;
  cliente_id: string | null;
  cliente_email: string | null;
  comprador_alias: string | null;
  ticket_id: string | null;
  evento: string;
  sector: string | null;
  fecha_evento: string | null;
  cantidad: number;
  moneda?: Moneda | null;
  notas: string | null;
}): Consulta {
  const now = new Date().toISOString();
  const c: Consulta = {
    id: crypto.randomUUID(),
    code: generateCode(),
    ...input,
    estado: "pendiente",
    operacion_id: null,
    resuelta_por: null,
    resuelta_at: null,
    created_at: now,
    updated_at: now,
  };
  db().consultas.unshift(c);
  return c;
}

// --- cotizaciones (espejo de 0041 y /api/consultas/[id]/{cotizar,aceptar,rechazar}) --
type MockRes<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export function mockGetVenceHoras(): number {
  return db().venceHoras;
}
export function mockSetVenceHoras(h: number): void {
  db().venceHoras = h;
}

export function mockCotizar(
  id: string,
  opts: { monto: number; fee: number; moneda: Moneda; quien: string; esAdmin: boolean }
): MockRes<{ consulta: Consulta }> {
  const c = db().consultas.find((x) => x.id === id);
  if (!c) return { ok: false, status: 404, error: "Consulta no encontrada" };
  if (c.estado !== "pendiente" && c.estado !== "cotizada") {
    return { ok: false, status: 409, error: "Esta consulta ya fue resuelta" };
  }
  const ahora = new Date();
  c.estado = "cotizada";
  c.cotizacion_monto = opts.monto;
  c.cotizacion_fee = opts.fee;
  c.moneda = opts.moneda;
  c.cotizacion_version = (c.cotizacion_version ?? 0) + 1;
  c.cotizada_at = ahora.toISOString();
  c.cotizada_por = opts.quien;
  c.cotizada_por_admin = opts.esAdmin;
  c.vence_at = new Date(ahora.getTime() + db().venceHoras * 3600_000).toISOString();
  c.updated_at = c.cotizada_at;
  return { ok: true, consulta: c };
}

// Espejo de la función aceptar_cotizacion: mismas validaciones, mismo orden.
export function mockAceptarCotizacion(
  id: string,
  opts: { version: number; clienteId: string | null; via: "web" | "whatsapp"; quien: string }
): MockRes<{ op: Operacion }> {
  const c = db().consultas.find((x) => x.id === id);
  if (!c || (opts.clienteId && c.cliente_id !== opts.clienteId)) {
    return { ok: false, status: 404, error: "Cotización no encontrada" };
  }
  if (c.estado !== "cotizada") return { ok: false, status: 409, error: "Esta cotización ya no está disponible" };
  if ((c.cotizacion_version ?? 0) !== opts.version) {
    return { ok: false, status: 409, error: "La cotización cambió: revisá el precio nuevo" };
  }
  if (c.vence_at && new Date(c.vence_at).getTime() < Date.now()) {
    return { ok: false, status: 409, error: "La cotización venció" };
  }
  const cantidad = Math.max(1, c.cantidad || 1);
  const monto = Number(c.cotizacion_monto);
  const ahora = new Date().toISOString();
  const op = mockCreateOp({
    evento: c.evento,
    comprador_alias: c.comprador_alias,
    vendedor_alias: null,
    monto,
    fee: Number(c.cotizacion_fee ?? 0),
    moneda: (c.moneda ?? "USD") as Moneda,
    cantidad,
    ticket_id: c.ticket_id,
    fecha_evento: c.fecha_evento,
    notas: [
      c.notas?.trim() || null,
      `Cotizada por ${c.cotizada_por ?? "staff"}. ` +
        (opts.via === "web"
          ? "Aceptada por el cliente en la web."
          : `Aceptada por WhatsApp (registró ${opts.quien}).`),
    ]
      .filter(Boolean)
      .join("\n"),
    cuenta_debitar: null,
    tipo: "pedido",
    cliente_id: c.cliente_id,
    cliente_email: c.cliente_email,
    sector: c.sector,
    envio_id: c.envio_id,
    // Solo un admin confirma: si cotizó un moderador, entra como "Nuevo".
    confirmada_at: c.cotizada_por_admin ? ahora : null,
    confirmada_por: c.cotizada_por_admin ? c.cotizada_por ?? null : null,
    items: [
      {
        ticket_id: c.ticket_id,
        evento: c.evento,
        sector: c.sector,
        fecha_evento: c.fecha_evento,
        cantidad,
        precio_unitario: Math.round((monto / cantidad) * 100) / 100,
      },
    ],
  });
  c.estado = "convertida";
  c.operacion_id = op.id;
  c.aceptada_at = ahora;
  c.aceptada_por = opts.quien;
  c.aceptada_via = opts.via;
  c.resuelta_at = ahora;
  c.resuelta_por = opts.quien;
  c.updated_at = ahora;
  // Nace confirmado: toma su stock ya (ver lib/stock.ts).
  mockStockOperacion(op, true);
  return { ok: true, op };
}

export function mockRechazarCotizacion(id: string, clienteId: string): MockRes {
  const c = db().consultas.find((x) => x.id === id && x.cliente_id === clienteId);
  if (!c) return { ok: false, status: 404, error: "Cotización no encontrada" };
  if (c.estado !== "cotizada") return { ok: false, status: 409, error: "Esta cotización ya no está disponible" };
  c.estado = "rechazada";
  c.resuelta_por = "cliente";
  c.resuelta_at = new Date().toISOString();
  c.updated_at = c.resuelta_at;
  return { ok: true };
}

// --- pasos del pedido y cancelación (espejo de 0040) ----------------------
export function mockGetTextosPago(): Record<string, string> {
  return { ...db().textos };
}

export function mockSetTextoPago(key: string, value: string): void {
  if (value) db().textos[key] = value;
  else delete db().textos[key];
}

// El cliente cancela su pedido: espejo de /api/mis-pedidos/[id]/cancelar y
// del trigger (solo antes de que se le pida pagar).
export function mockClienteCancelarOp(
  id: string,
  clienteId: string
): { ok: true } | { ok: false; status: number; error: string } {
  const op = db().ops.find((o) => o.id === id && o.cliente_id === clienteId);
  if (!op) return { ok: false, status: 404, error: "Pedido no encontrado" };
  if (!clientePuedeCancelar(op)) {
    return { ok: false, status: 409, error: "El pedido ya avanzó; para cancelarlo escribinos" };
  }
  const now = new Date().toISOString();
  op.status = "cancelada";
  op.cancelada_at = now;
  op.cancelada_por = "cliente";
  op.updated_at = now;
  // Un pedido confirmado ya tomó su stock: cancelarlo lo devuelve.
  mockStockOperacion(op, false);
  return { ok: true };
}

export function mockClienteCancelarConsulta(
  id: string,
  clienteId: string
): { ok: true } | { ok: false; status: number; error: string } {
  const c = db().consultas.find((x) => x.id === id && x.cliente_id === clienteId);
  if (!c) return { ok: false, status: 404, error: "Consulta no encontrada" };
  if (c.estado !== "pendiente" && c.estado !== "cotizada") {
    return { ok: false, status: 409, error: "Esta consulta ya fue resuelta" };
  }
  c.estado = "cancelada";
  c.resuelta_por = "cliente";
  c.resuelta_at = new Date().toISOString();
  c.updated_at = c.resuelta_at;
  return { ok: true };
}

export function mockDescartarConsulta(
  id: string,
  quien: string
): { ok: true } | { ok: false; status: number; error: string } {
  const c = db().consultas.find((x) => x.id === id);
  if (!c) return { ok: false, status: 404, error: "Consulta no encontrada" };
  if (c.estado !== "pendiente" && c.estado !== "cotizada") {
    return { ok: false, status: 409, error: "Esta consulta ya fue resuelta" };
  }
  c.estado = "descartada";
  c.resuelta_por = quien;
  c.resuelta_at = new Date().toISOString();
  c.updated_at = c.resuelta_at;
  return { ok: true };
}


// ---- avisos (espejo de notificaciones) --------------------------------------
/** Guarda el aviso si su clave es nueva. null = ya existía (no se re-avisa). */
export function mockGuardarAviso(a: NuevoAviso): AvisoGuardado | null {
  const d = db();
  if (d.avisos.some((x) => x.clave === a.clave)) return null;
  const fila: AvisoGuardado = {
    ...a,
    id: crypto.randomUUID(),
    leida_at: null,
    whatsapp_estado: a.whatsapp_estado ?? "no_aplica",
    whatsapp_error: null,
    whatsapp_destino: a.whatsapp_destino ?? null,
    email_error: null,
    created_at: new Date().toISOString(),
  };
  d.avisos.push(fila);
  return fila;
}

export function mockActualizarAviso(id: string, patch: Partial<AvisoGuardado>): void {
  const a = db().avisos.find((x) => x.id === id);
  if (a) Object.assign(a, patch);
}

export function mockListAvisos(filtro: (a: AvisoGuardado) => boolean, limite = 30): AvisoGuardado[] {
  return db()
    .avisos.filter(filtro)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limite);
}
