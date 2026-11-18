import { describe, expect, it } from "vitest";
import { avisoSinConfirmar, importesPanel } from "@/lib/importes-panel";
import { computeMetrics } from "@/lib/metrics";

const AHORA = new Date("2026-11-18T12:00:00Z");
const op = (o: Record<string, unknown> = {}) => ({
  status: "esperando_entrada" as const,
  tipo: "manual" as const,
  confirmada_at: null,
  pago_pedido_at: "2026-11-18T10:00:00Z",
  entrada_recibida_at: null,
  pago_confirmado_at: null,
  pago_proveedor_at: null,
  cerrada_at: null,
  monto: 1000,
  fee: 100,
  moneda: "USD",
  ...o,
});

describe("TKT-22: importes arriba del panel", () => {
  const ops = [
    op(), // esperando pago
    op({ pago_pedido_at: "2026-11-10T10:00:00Z" }), // vencido: sigue por cobrar
    op({ pago_informado_at: "x" }), // avisó que pagó: falta verificarlo
    op({ pago_confirmado_at: "2026-11-17T10:00:00Z" }), // cobrado, debo al proveedor
    op({ pago_confirmado_at: "2026-11-17T10:00:00Z", pago_proveedor_at: "x" }), // ya pagado
    op({ status: "cancelada" }),
    op({ pago_confirmado_at: "2026-11-17T10:00:00Z", reembolso_at: "x" }), // reembolso: no se le debe
    op({ moneda: "ARS", monto: 900000 }), // otra moneda: no se suma
  ];

  it("por cobrar, a pagar al proveedor (monto − comisión) y acumulados", () => {
    const r = importesPanel(ops as any, computeMetrics(ops as any), AHORA);
    expect(r).toMatchObject({
      moneda: "USD",
      porCobrar: 3000,
      porCobrarOps: 3,
      aPagarProveedor: 900,
      aPagarProveedorOps: 1,
      // El reembolsado no es venta (0059): cuentan los dos cobrados.
      ventas: 2000,
      comision: 200,
    });
  });

  it("el aviso dice cuántos pedidos faltan confirmar", () => {
    expect(avisoSinConfirmar(0)).toBeNull();
    expect(avisoSinConfirmar(1)).toBe("Tenés 1 pedido sin confirmar");
    expect(avisoSinConfirmar(5)).toBe("Tenés 5 pedidos sin confirmar");
  });
});
