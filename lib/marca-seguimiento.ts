// Marca del link público de seguimiento (/op/[id]). Es la pantalla que el
// agente le reenvía a su pasajero, y frente al pasajero el vendedor es
// TicketMirror (TKT-20): ninguna otra marca en el encabezado, la franja ni el pie.
export const MARCA_SEGUIMIENTO = {
  encabezado: "TicketMirror",
  // Se repite como microtexto de seguridad; el CSS la recorta (nowrap +
  // overflow hidden), así que el largo no rompe la franja.
  franja: "TICKETMIRROR·OPERACIÓN VERIFICADA·",
  pie: "TicketMirror · Seguimiento de operaciones",
} as const;
