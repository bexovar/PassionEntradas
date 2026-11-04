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

// Lo que llega a la tarjeta del seguimiento. Igual que la vista pública de la
// base, pero con los importes opcionales: en la vista pública no existen.
export type OperacionSeguimiento = Omit<OperacionPublica, "monto"> & { monto: number | null };
export type ItemSeguimiento = Omit<ItemPublico, "precio_unitario"> & { precio_unitario: number | null };

// Recorta en el servidor, antes de renderizar: lo que no se muestra tampoco
// viaja en el HTML ni en el payload de React.
export function recortarParaPublico(
  op: OperacionPublica,
  items: ItemPublico[]
): { op: OperacionSeguimiento; items: ItemSeguimiento[] } {
  return {
    op: { ...op, monto: null, comprador_alias: nombreDePila(op.comprador_alias) },
    items: items.map((i) => ({ ...i, precio_unitario: null })),
  };
}
