import { describe, expect, it } from "vitest";
import { avisoDeSobreventa, movimientoDeStock } from "./stock";

const nueva = { status: "esperando_entrada", pago_confirmado_at: null as string | null, confirmada_at: null as string | null };
const confirmada = { ...nueva, confirmada_at: "2026-10-01T00:00:00Z" };
const paga = { ...confirmada, pago_confirmado_at: "2026-10-02T00:00:00Z" };

describe("movimientoDeStock (se toma al confirmar)", () => {
  it("confirmar toma stock", () => {
    expect(movimientoDeStock({ action: "confirmar" }, nueva, confirmada)).toBe("tomar");
  });
  it("marcar un paso de un pedido sin confirmar lo confirma: toma", () => {
    expect(movimientoDeStock({ action: "entrada", done: true }, nueva, { ...nueva, confirmada_at: "x", } )).toBe("tomar");
    expect(movimientoDeStock({ action: "proveedor", done: true }, nueva, { ...nueva, confirmada_at: "x" })).toBe("tomar");
  });
  it("marcar pasos de uno ya confirmado no vuelve a tomar", () => {
    expect(movimientoDeStock({ action: "entrada", done: true }, confirmada, confirmada)).toBeNull();
    expect(movimientoDeStock({ action: "cerrar", done: true }, paga, paga)).toBeNull();
    expect(movimientoDeStock({ action: "cerrar", done: false }, paga, paga)).toBeNull();
  });
  it("pagar toma si todavía no se había tomado (la base no descuenta dos veces)", () => {
    expect(movimientoDeStock({ action: "pago", done: true }, confirmada, paga)).toBe("tomar");
  });
  it("desmarcar el pago de uno confirmado NO devuelve: sigue confirmado", () => {
    expect(movimientoDeStock({ action: "pago", done: false }, paga, confirmada)).toBeNull();
    // Sin confirmar (operaciones viejas): devuelve como antes.
    expect(movimientoDeStock({ action: "pago", done: false }, { ...nueva, pago_confirmado_at: "x" }, nueva)).toBe("devolver");
  });
  it("cancelar devuelve; reabrir una confirmada vuelve a tomar", () => {
    expect(movimientoDeStock({ action: "cancelar" }, confirmada, { ...confirmada, status: "cancelada" })).toBe("devolver");
    expect(movimientoDeStock({ action: "reabrir" }, { ...confirmada, status: "cancelada" }, confirmada)).toBe("tomar");
    expect(movimientoDeStock({ action: "reabrir" }, { ...nueva, status: "cancelada" }, nueva)).toBeNull();
  });
});

describe("avisoDeSobreventa", () => {
  it("sin faltante, sin aviso", () => {
    expect(avisoDeSobreventa([{ ticket_id: "a", cantidad: 2, pedido: 2 }])).toBeNull();
    expect(avisoDeSobreventa([])).toBeNull();
    expect(avisoDeSobreventa(null)).toBeNull();
  });
  it("avisa cuántas faltaron", () => {
    expect(avisoDeSobreventa([{ ticket_id: "a", cantidad: 1, pedido: 3 }])).toMatch(/faltaron 2 entradas/);
    expect(avisoDeSobreventa([{ ticket_id: "a", cantidad: 0, pedido: 1 }])).toMatch(/faltaron 1 entrada\b/);
  });
});
