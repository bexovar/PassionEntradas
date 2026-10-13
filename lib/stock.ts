// Stock de entradas propias: cuándo se descuenta y cuándo se devuelve.
//
// Se descuenta cuando el pedido queda CONFIRMADO (el admin lo confirma, marca
// cualquier paso, o nace confirmado al aceptar una cotización) y por la
// cantidad real de cada línea. Antes era recién al pagar: entre la
// confirmación y el pago la tienda seguía ofreciendo esas entradas. Se
// devuelve al cancelar (el admin o el cliente). El movimiento en sí lo hace la
// función de la base `stock_operacion` (migración 0039), que deja registrado
// en la operación cuánto descontó: devolver devuelve exactamente eso, y tomar
// dos veces no descuenta dos veces. Acá solo se decide QUÉ hacer según la
// acción del panel.

import type { StatusAction } from "@/lib/operaciones";

export type MovimientoStock = "tomar" | "devolver" | null;

type Estado = { status: string; pago_confirmado_at: string | null; confirmada_at?: string | null };

export function movimientoDeStock(action: StatusAction, antes: Estado, despues: Estado): MovimientoStock {
  switch (action.action) {
    case "confirmar":
      return "tomar";
    case "cancelar":
      // Cancelar libera lo que se había tomado.
      return "devolver";
    case "reabrir":
      // Reabrir una confirmada (o paga) vuelve a tomar su stock.
      return despues.confirmada_at || despues.pago_confirmado_at ? "tomar" : null;
    case "pago":
      // Pagar toma si todavía no se había tomado (pedidos confirmados antes
      // de este cambio). Desmarcar el pago de uno confirmado no devuelve:
      // sigue confirmado.
      if (action.done) return "tomar";
      return despues.confirmada_at ? null : "devolver";
    default:
      // Marcar un paso confirma el pedido si no lo estaba: ahí se toma.
      return action.done && !antes.confirmada_at && despues.confirmada_at ? "tomar" : null;
  }
}

export type LineaDescontada = { ticket_id: string; cantidad: number; pedido: number };

// Sobreventa: se pidió más de lo que había. La base nunca deja el stock en
// negativo, así que descuenta lo que hay; el panel avisa con este texto.
export function avisoDeSobreventa(lineas: LineaDescontada[] | null | undefined): string | null {
  const cortas = (lineas ?? []).filter((l) => l.cantidad < l.pedido);
  if (cortas.length === 0) return null;
  const faltan = cortas.reduce((a, l) => a + (l.pedido - l.cantidad), 0);
  return `Ojo: no alcanzaba el stock de la tienda (faltaron ${faltan} ${
    faltan === 1 ? "entrada" : "entradas"
  }). Revisá la disponibilidad antes de confirmar con el cliente.`;
}
