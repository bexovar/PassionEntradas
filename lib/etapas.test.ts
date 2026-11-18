import { describe, expect, it } from "vitest";
import {
  ETAPAS_PANEL,
  etapaDe,
  motivoBloqueo,
  pasoSiguiente,
  puedeDesmarcar,
  puedeMarcar,
  puedePedirPago,
  puedePedirReembolso,
  type OpEtapa,
} from "@/lib/etapas";
import { PESTANAS } from "@/lib/panel-filtros";

const AHORA = new Date("2026-11-18T12:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000).toISOString();

const op = (o: Partial<OpEtapa> = {}): OpEtapa => ({
  status: "esperando_entrada",
  tipo: "pedido",
  confirmada_at: hace(1),
  pago_pedido_at: hace(1),
  entrada_recibida_at: null,
  pago_confirmado_at: null,
  pago_proveedor_at: null,
  cerrada_at: null,
  ...o,
});

describe("TKT-21: las etapas salen de los hitos, en orden", () => {
  it("recorre las ocho de la operación hasta entregada", () => {
    expect(etapaDe(op({ confirmada_at: null, pago_pedido_at: null }), AHORA)).toBe("pendiente_confirmar");
    expect(etapaDe(op(), AHORA)).toBe("esperando_pago");
    expect(etapaDe(op({ pago_pedido_at: hace(25) }), AHORA)).toBe("vencido");
    expect(etapaDe(op({ pago_informado_at: hace(0.5) }), AHORA)).toBe("pago_informado");
    expect(etapaDe(op({ pago_confirmado_at: hace(0.5) }), AHORA)).toBe("pendiente_pago_proveedor");
    expect(etapaDe(op({ pago_confirmado_at: "x", pago_proveedor_at: "x" }), AHORA)).toBe("esperando_envio_proveedor");
    expect(
      etapaDe(op({ pago_confirmado_at: "x", pago_proveedor_at: "x", entrada_recibida_at: "x" }), AHORA)
    ).toBe("listo_para_enviar");
    expect(
      etapaDe(op({ pago_confirmado_at: "x", pago_proveedor_at: "x", entrada_recibida_at: "x", cerrada_at: "x" }), AHORA)
    ).toBe("entregada");
  });

  it("el vencido corre desde el pedido de pago: 24 h justas todavía no", () => {
    expect(etapaDe(op({ pago_pedido_at: hace(24) }), AHORA)).toBe("esperando_pago");
    expect(etapaDe(op({ pago_pedido_at: hace(24.01) }), AHORA)).toBe("vencido");
    // Sin pedido de pago (operaciones viejas, cargas del staff) no vence nunca.
    expect(etapaDe(op({ pago_pedido_at: null, tipo: "operacion" }), AHORA)).toBe("esperando_pago");
    // Avisar que pagó lo saca del vencido.
    expect(etapaDe(op({ pago_pedido_at: hace(48), pago_informado_at: hace(1) }), AHORA)).toBe("pago_informado");
  });

  it("una operación vieja con los hitos en otro orden cae en el primer paso que le falta", () => {
    // Modelo anterior: se entregaba antes de pagarle al proveedor.
    const vieja = op({ pago_confirmado_at: "x", entrada_recibida_at: "x", cerrada_at: "x" });
    expect(etapaDe(vieja, AHORA)).toBe("pendiente_pago_proveedor");
    expect(pasoSiguiente(vieja)).toBe("proveedor");
  });

  it("salidas: cancelada y reembolso ganan sobre los pasos", () => {
    expect(etapaDe(op({ status: "cancelada", pago_confirmado_at: "x" }), AHORA)).toBe("cancelada");
    expect(etapaDe(op({ pago_confirmado_at: "x", reembolso_at: "x" }), AHORA)).toBe("reembolso_pendiente");
    expect(etapaDe(op({ pago_confirmado_at: "x", reembolso_at: "x", reembolsado_at: "x" }), AHORA)).toBe("reembolsado");
  });
});

describe("TKT-21: se avanza de a un paso, y se vuelve uno", () => {
  it("solo se marca el siguiente; el pago se puede verificar sin aviso del cliente", () => {
    const o = op();
    expect(puedeMarcar(o, "informar")).toBe(true);
    expect(puedeMarcar(o, "pago")).toBe(true);
    expect(puedeMarcar(o, "proveedor")).toBe(false);
    expect(puedeMarcar(o, "entrada")).toBe(false);
    expect(puedeMarcar(o, "cerrar")).toBe(false);
    expect(motivoBloqueo(o, "entrada", true)).toBe("Primero marcá «Pago verificado»");
    expect(pasoSiguiente(o)).toBe("pago");
  });

  it("solo se desmarca el último", () => {
    const o = op({ pago_confirmado_at: "x", pago_proveedor_at: "x" });
    expect(puedeDesmarcar(o, "proveedor")).toBe(true);
    expect(puedeDesmarcar(o, "pago")).toBe(false);
    expect(motivoBloqueo(o, "pago", false)).toBe("Primero desmarcá «Pago al proveedor»");
  });

  it("con el pago verificado ya no tiene sentido 'pago informado'", () => {
    expect(puedeMarcar(op({ pago_confirmado_at: "x" }), "informar")).toBe(false);
  });

  it("cancelada y en reembolso quedan quietas", () => {
    expect(puedeMarcar(op({ status: "cancelada" }), "pago")).toBe(false);
    expect(puedeMarcar(op({ pago_confirmado_at: "x", reembolso_at: "x" }), "proveedor")).toBe(false);
    expect(pasoSiguiente(op({ status: "cancelada" }))).toBeNull();
  });

  it("pedir el pago: confirmada y sin pagar", () => {
    expect(puedePedirPago(op({ pago_pedido_at: hace(30) }))).toBe(true);
    expect(puedePedirPago(op({ confirmada_at: null }))).toBe(false);
    expect(puedePedirPago(op({ pago_informado_at: "x" }))).toBe(false);
    expect(puedePedirPago(op({ pago_confirmado_at: "x" }))).toBe(false);
  });

  it("reembolso: el cliente pagó (o avisó) y no se entregó", () => {
    expect(puedePedirReembolso(op())).toBe(false);
    expect(puedePedirReembolso(op({ pago_informado_at: "x" }))).toBe(true);
    expect(puedePedirReembolso(op({ pago_confirmado_at: "x", pago_proveedor_at: "x" }))).toBe(true);
    expect(puedePedirReembolso(op({ pago_confirmado_at: "x", cerrada_at: "x" }))).toBe(false);
  });
});

describe("TKT-21 aceptación: el tablero", () => {
  it("son las ocho etapas de Ignacio, en orden", () => {
    expect(ETAPAS_PANEL.map((e) => e.label)).toEqual([
      "A cotizar",
      "Pendiente de confirmar",
      "Esperando pago",
      "Vencidos",
      "Pago informado",
      "Pendiente de pago al proveedor",
      "Esperando envío del proveedor",
      "Listo para enviar al cliente",
    ]);
  });

  it("'Esperando cliente' ya no existe con ese nombre", () => {
    const etiquetas = [...ETAPAS_PANEL.map((e) => e.label), ...PESTANAS.map((p) => p.label)];
    expect(etiquetas).not.toContain("Esperando cliente");
  });
});
