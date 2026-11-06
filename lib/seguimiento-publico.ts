import { esStaff, type Rol } from "./auth";
import type { ItemPublico, OperacionPublica } from "./operaciones";

// El link de seguimiento /op/<uuid> se abre sin sesión: es compartible a
// propósito, la agencia se lo manda a su pasajero (y viaja por WhatsApp, se
// reenvía a grupos). Lo que NO puede mostrarle es el monto: es lo que la
// agencia le paga a TicketMirror, no lo que el pasajero le paga a la agencia,
// y verlo es ver el margen de la agencia (TKT-24).
//
// Dos vistas de la misma operación:
//   - completa: el agente dueño (cliente_id) y el staff — monto, precio por
//     línea y nombre completo del comprador;
//   - publica: cualquier otro, con o sin sesión — estado, evento, fechas y
//     código, sin ningún importe y con el comprador por su nombre de pila.

export type VistaSeguimiento = "completa" | "publica";

export function vistaSeguimiento(
  visitante: { id: string; rol: Rol | null } | null,
  clienteId: string | null
): VistaSeguimiento {
  if (!visitante) return "publica";
  if (esStaff(visitante.rol)) return "completa";
  if (visitante.rol === "cliente" && clienteId !== null && visitante.id === clienteId) {
    return "completa";
  }
  return "publica";
}

// "María Emilia Gallo" -> "María". El alias a veces es un email (el cliente
// sin nombre cargado): un email identifica a la persona, no se muestra.
export function nombreDePila(alias: string | null): string | null {
  const limpio = alias?.trim() ?? "";
  if (!limpio || limpio.includes("@")) return null;
  return limpio.split(/\s+/)[0];
}

// Lo que llega a la tarjeta del seguimiento: la vista pública de la base más
// los importes, que solo existen en la vista completa (null en la pública).
export type OperacionSeguimiento = OperacionPublica & { monto: number | null };
export type ItemSeguimiento = ItemPublico & { precio_unitario: number | null };

// Recorta en el servidor, antes de renderizar: lo que no se muestra tampoco
// viaja en el HTML ni en el payload de React. Acepta filas con importes (una
// base sin 0053, o el modo demo) y los descarta: se copian solo los campos
// públicos, así un campo nuevo del RPC no se cuela sin que nadie lo decida.
export function recortarParaPublico(
  op: OperacionPublica & { monto?: unknown },
  items: (ItemPublico & { precio_unitario?: unknown })[]
): { op: OperacionSeguimiento; items: ItemSeguimiento[] } {
  return {
    op: {
      code: op.code,
      evento: op.evento,
      comprador_alias: nombreDePila(op.comprador_alias),
      vendedor_alias: op.vendedor_alias,
      moneda: op.moneda,
      status: op.status,
      entrada_recibida_at: op.entrada_recibida_at,
      pago_confirmado_at: op.pago_confirmado_at,
      cerrada_at: op.cerrada_at,
      fecha_evento: op.fecha_evento,
      updated_at: op.updated_at,
      tipo: op.tipo,
      confirmada_at: op.confirmada_at,
      monto: null,
    },
    items: items.map((i) => ({
      evento: i.evento,
      sector: i.sector,
      fecha_evento: i.fecha_evento,
      cantidad: i.cantidad,
      precio_unitario: null,
    })),
  };
}
