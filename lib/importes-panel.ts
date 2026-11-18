import { etapaDe, type OpEtapa } from "@/lib/etapas";
import type { Metrics } from "@/lib/metrics";
import type { Moneda } from "@/lib/operaciones";

// Los importes arriba del panel (TKT-22): lo que Ignacio necesita para
// decidir, en la misma pantalla donde opera.
//
//  - Por cobrar: le pedimos el pago al cliente y todavía no lo verificamos
//    (esperando pago, vencidos y pago informado).
//  - A pagar al proveedor: cobrado y sin pagarle al proveedor. Lo que va al
//    proveedor es el monto menos nuestra comisión (fee).
//  - Comisión y ventas acumuladas: las de Métricas (RPC metricas_operaciones),
//    todo el historial, no solo lo cargado en el panel.
//
// Por cobrar y a pagar se calculan con las operaciones del panel (las
// abiertas son las recientes, entran en el tope de 1000) para que cambien en
// el momento al marcar un paso. Una sola moneda: la de Métricas. Pesos y
// dólares no se suman.

type OpImporte = OpEtapa & {
  monto: number;
  fee: number;
  moneda: Moneda | string | null;
};

export type ImportesPanel = {
  moneda: string;
  porCobrar: number;
  porCobrarOps: number;
  aPagarProveedor: number;
  aPagarProveedorOps: number;
  comision: number;
  ventas: number;
};

export function importesPanel(ops: OpImporte[], acumulados: Metrics, ahora: Date = new Date()): ImportesPanel {
  const moneda = acumulados.moneda;
  const r: ImportesPanel = {
    moneda,
    porCobrar: 0,
    porCobrarOps: 0,
    aPagarProveedor: 0,
    aPagarProveedorOps: 0,
    comision: acumulados.comisionGanada,
    ventas: acumulados.plataMovida,
  };
  for (const o of ops) {
    if ((o.moneda ?? "USD") !== moneda) continue;
    const e = etapaDe(o, ahora);
    if (e === "esperando_pago" || e === "vencido" || e === "pago_informado") {
      r.porCobrar += Number(o.monto) || 0;
      r.porCobrarOps++;
    } else if (e === "pendiente_pago_proveedor") {
      r.aPagarProveedor += Math.max(0, (Number(o.monto) || 0) - (Number(o.fee) || 0));
      r.aPagarProveedorOps++;
    }
  }
  return r;
}

/** "Tenés 5 pedidos sin confirmar" (null si no hay ninguno). */
export function avisoSinConfirmar(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "Tenés 1 pedido sin confirmar" : `Tenés ${n} pedidos sin confirmar`;
}
