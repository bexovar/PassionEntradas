import { beforeEach, describe, expect, it } from "vitest";
import {
  mockApplyAction,
  mockClienteCancelarOp,
  mockCreateOp,
  mockListManual,
} from "./mock-db";

// El stock de una entrada propia se toma cuando el pedido queda confirmado y
// vuelve al cancelarlo (lib/stock.ts), contra la base de prueba.
const CLIENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOCA = "manual::demo-ars";
const stock = () => mockListManual().find((t) => t.id === BOCA)!.stock ?? 0;

const pedido = (cantidad: number) =>
  mockCreateOp({
    evento: "Boca vs Vasco da Gama",
    comprador_alias: "Demo",
    vendedor_alias: null,
    monto: 1000 * cantidad,
    fee: 0,
    ticket_id: BOCA,
    fecha_evento: null,
    notas: null,
    cuenta_debitar: null,
    tipo: "pedido",
    cliente_id: CLIENTE,
    cliente_email: "demo@passion.local",
    cantidad,
    moneda: "ARS",
    items: [{ ticket_id: BOCA, evento: "Boca vs Vasco da Gama", sector: "Platea Baja", fecha_evento: null, cantidad, precio_unitario: 1000 }],
  });

describe("stock al confirmar", () => {
  beforeEach(() => {
    process.env.MOCK_DATA = "1";
    (globalThis as { __passionMockDb?: unknown }).__passionMockDb = undefined;
  });

  it("pedir no toca el stock; confirmar lo descuenta; pagar no lo descuenta otra vez", () => {
    const inicial = stock();
    const op = pedido(2);
    expect(stock()).toBe(inicial);
    mockApplyAction(op.id, { action: "confirmar" });
    expect(stock()).toBe(inicial - 2);
    mockApplyAction(op.id, { action: "pago", done: true });
    expect(stock()).toBe(inicial - 2);
    // Desmarcar el pago: sigue confirmado, el stock no vuelve.
    mockApplyAction(op.id, { action: "pago", done: false });
    expect(stock()).toBe(inicial - 2);
  });

  it("marcar un paso de un pedido sin confirmar también lo descuenta", () => {
    const inicial = stock();
    const op = pedido(1);
    mockApplyAction(op.id, { action: "entrada", done: true });
    expect(stock()).toBe(inicial - 1);
  });

  it("el admin cancela: vuelve; reabrir lo toma de nuevo", () => {
    const inicial = stock();
    const op = pedido(2);
    mockApplyAction(op.id, { action: "confirmar" });
    mockApplyAction(op.id, { action: "cancelar" });
    expect(stock()).toBe(inicial);
    mockApplyAction(op.id, { action: "reabrir" });
    expect(stock()).toBe(inicial - 2);
  });

  it("el cliente cancela un pedido confirmado desde Mis pedidos: vuelve", () => {
    const inicial = stock();
    const op = pedido(2);
    mockApplyAction(op.id, { action: "confirmar" });
    expect(stock()).toBe(inicial - 2);
    expect(mockClienteCancelarOp(op.id, CLIENTE)).toEqual({ ok: true });
    expect(stock()).toBe(inicial);
  });
});

describe("aviso al cliente cuando se cotiza su consulta", () => {
  beforeEach(() => {
    process.env.MOCK_DATA = "1";
    (globalThis as { __passionMockDb?: unknown }).__passionMockDb = undefined;
  });

  it("queda en su campana, una vez por versión de la cotización", async () => {
    const { avisarCotizacionAlCliente } = await import("./avisos-cliente");
    const { mockCotizar, mockListAvisos, mockListConsultas } = await import("./mock-db");
    const c = mockListConsultas().find((x) => x.estado === "pendiente" && x.cliente_id === CLIENTE)!;
    const avisos = () => mockListAvisos((a) => a.audiencia === "cliente" && a.consulta_id === c.id, 50);

    const r1 = mockCotizar(c.id, { monto: 1000, fee: 100, moneda: "USD", quien: "x", esAdmin: true });
    if (!r1.ok) throw new Error(r1.error);
    await avisarCotizacionAlCliente(null, r1.consulta, "https://x");
    await avisarCotizacionAlCliente(null, r1.consulta, "https://x");
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].tipo).toBe("cotizacion_lista");
    expect(avisos()[0].destinatario_id).toBe(CLIENTE);
    expect(avisos()[0].url).toBe("https://x/mis-pedidos");

    // Re-cotizada (otro precio): aviso nuevo.
    const r2 = mockCotizar(c.id, { monto: 900, fee: 100, moneda: "USD", quien: "x", esAdmin: true });
    if (!r2.ok) throw new Error(r2.error);
    await avisarCotizacionAlCliente(null, r2.consulta, "https://x");
    expect(avisos()).toHaveLength(2);
  });
});
