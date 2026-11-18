// Máquina de estados de la operación (TKT-21). Las ocho etapas que describió
// Ignacio, más las salidas (cancelada, reembolso) y el final (entregada).
//
// La etapa NO se guarda: se lee de los hitos, en un orden fijo. Es el primer
// paso que falta:
//
//   confirmar → (cliente avisa que pagó) → pago verificado → pago al proveedor
//   → entrada del proveedor → entrega al cliente
//
// Así una operación vieja, con los hitos marcados en otro orden (el modelo
// anterior no tenía orden), cae sola en lo que le falta hacer. El orden se
// impone al marcar: solo se puede marcar el paso siguiente y desmarcar el
// último (`puedeMarcar` / `puedeDesmarcar`, que usan la API y el panel).
//
// "A cotizar" (la primera de las ocho) no es una operación: es una consulta
// sin precio (ver lib/cotizaciones.ts). El panel la cuenta desde ahí.

import { necesitaConfirmar, type Operacion } from "@/lib/operaciones";

export type Etapa =
  | "pendiente_confirmar"
  | "esperando_pago"
  | "vencido"
  | "pago_informado"
  | "pendiente_pago_proveedor"
  | "esperando_envio_proveedor"
  | "listo_para_enviar"
  | "entregada"
  | "reembolso_pendiente"
  | "reembolsado"
  | "cancelada";

// Los pasos que se marcan, en orden. "informar" es opcional: el admin puede
// verificar el pago en el banco sin que el cliente haya avisado.
export type Hito = "informar" | "pago" | "proveedor" | "entrada" | "cerrar";
export const SECUENCIA: Hito[] = ["informar", "pago", "proveedor", "entrada", "cerrar"];

export const COLUMNA_HITO: Record<Hito, { at: keyof OpEtapa; por: string }> = {
  informar: { at: "pago_informado_at", por: "pago_informado_por" },
  pago: { at: "pago_confirmado_at", por: "pago_confirmado_por" },
  proveedor: { at: "pago_proveedor_at", por: "pago_proveedor_por" },
  entrada: { at: "entrada_recibida_at", por: "entrada_recibida_por" },
  cerrar: { at: "cerrada_at", por: "cerrada_por" },
};

// Lo que pide cada paso antes de poder marcarse (los obligatorios de antes).
const REQUIERE: Record<Hito, Hito[]> = {
  informar: [],
  pago: [],
  proveedor: ["pago"],
  entrada: ["pago", "proveedor"],
  cerrar: ["pago", "proveedor", "entrada"],
};

/** Horas que tiene el cliente para pagar desde que se le pide el pago. */
export const HORAS_PARA_PAGAR = 24;

export type OpEtapa = Pick<
  Operacion,
  "status" | "tipo" | "entrada_recibida_at" | "pago_confirmado_at" | "pago_proveedor_at" | "cerrada_at"
> & {
  confirmada_at?: string | null;
  pago_pedido_at?: string | null;
  pago_informado_at?: string | null;
  reembolso_at?: string | null;
  reembolsado_at?: string | null;
};

const hecho = (op: OpEtapa, h: Hito) => !!op[COLUMNA_HITO[h].at];

/** Cuándo vence el pedido de pago (null: no se pidió o no aplica). */
export function venceElPago(op: Pick<OpEtapa, "pago_pedido_at">): Date | null {
  if (!op.pago_pedido_at) return null;
  const t = Date.parse(op.pago_pedido_at);
  return Number.isFinite(t) ? new Date(t + HORAS_PARA_PAGAR * 3_600_000) : null;
}

export function etapaDe(op: OpEtapa, ahora: Date = new Date()): Etapa {
  if (op.status === "cancelada") return "cancelada";
  if (op.reembolsado_at) return "reembolsado";
  if (op.reembolso_at) return "reembolso_pendiente";
  if (necesitaConfirmar(op)) return "pendiente_confirmar";
  if (!op.pago_confirmado_at) {
    if (op.pago_informado_at) return "pago_informado";
    const vence = venceElPago(op);
    return vence && ahora.getTime() > vence.getTime() ? "vencido" : "esperando_pago";
  }
  if (!op.pago_proveedor_at) return "pendiente_pago_proveedor";
  if (!op.entrada_recibida_at) return "esperando_envio_proveedor";
  if (!op.cerrada_at) return "listo_para_enviar";
  return "entregada";
}

/** Las que no se tocan más con los pasos: canceladas y en reembolso. */
function quieta(op: OpEtapa): boolean {
  return op.status === "cancelada" || !!op.reembolso_at;
}

/** ¿Se puede marcar este paso ahora? Solo el siguiente (lo anterior hecho). */
export function puedeMarcar(op: OpEtapa, h: Hito): boolean {
  if (quieta(op) || hecho(op, h)) return false;
  // Avisar que pagó no tiene sentido con el pago ya verificado.
  if (h === "informar" && op.pago_confirmado_at) return false;
  return REQUIERE[h].every((r) => hecho(op, r));
}

/** ¿Se puede desmarcar? Solo el último hecho (nada después marcado). */
export function puedeDesmarcar(op: OpEtapa, h: Hito): boolean {
  if (quieta(op) || !hecho(op, h)) return false;
  const despues = SECUENCIA.slice(SECUENCIA.indexOf(h) + 1);
  return !despues.some((d) => hecho(op, d));
}

/** Por qué no se puede tocar un paso (para el panel y el 409 de la API). */
export function motivoBloqueo(op: OpEtapa, h: Hito, done: boolean): string | null {
  if (op.status === "cancelada") return "La operación está cancelada; reabrila para editar hitos";
  if (op.reembolso_at) return "La operación está en reembolso; sacala del reembolso para editar hitos";
  if (done) {
    if (hecho(op, h)) return `«${NOMBRE_PASO[h]}» ya está marcado`;
    if (h === "informar" && op.pago_confirmado_at) return "El pago ya está verificado";
    const falta = REQUIERE[h].find((r) => !hecho(op, r));
    return falta ? `Primero marcá «${NOMBRE_PASO[falta]}»` : null;
  }
  if (!hecho(op, h)) return `«${NOMBRE_PASO[h]}» no está marcado`;
  const despues = SECUENCIA.slice(SECUENCIA.indexOf(h) + 1).find((d) => hecho(op, d));
  return despues ? `Primero desmarcá «${NOMBRE_PASO[despues]}»` : null;
}

/** El paso que hace avanzar la etapa (el que el panel destaca). */
export function pasoSiguiente(op: OpEtapa): Hito | null {
  if (quieta(op)) return null;
  // Esperando pago: lo que destraba es verificar el pago (avisar es opcional).
  const orden: Hito[] = ["pago", "proveedor", "entrada", "cerrar"];
  return orden.find((h) => puedeMarcar(op, h)) ?? null;
}

/** Se puede pedir (o volver a pedir) el pago: confirmada y sin pagar. */
export function puedePedirPago(op: OpEtapa): boolean {
  if (quieta(op) || necesitaConfirmar(op)) return false;
  return !op.pago_confirmado_at && !op.pago_informado_at;
}

/** Reembolso: el cliente ya mandó la plata y no se consiguió la entrada. */
export function puedePedirReembolso(op: OpEtapa): boolean {
  if (op.status === "cancelada" || op.reembolso_at || op.cerrada_at) return false;
  return !!op.pago_informado_at || !!op.pago_confirmado_at;
}

export const NOMBRE_PASO: Record<Hito, string> = {
  informar: "Pago informado",
  pago: "Pago verificado",
  proveedor: "Pago al proveedor",
  entrada: "Entrada del proveedor",
  cerrar: "Entregada al cliente",
};

export const ETAPA_LABEL: Record<Etapa, string> = {
  pendiente_confirmar: "Pendiente de confirmar",
  esperando_pago: "Esperando pago",
  vencido: "Vencido",
  pago_informado: "Pago informado",
  pendiente_pago_proveedor: "Pendiente de pago al proveedor",
  esperando_envio_proveedor: "Esperando envío del proveedor",
  listo_para_enviar: "Listo para enviar al cliente",
  entregada: "Entregada",
  reembolso_pendiente: "Reembolso pendiente",
  reembolsado: "Reembolsada",
  cancelada: "Cancelada",
};

// Qué hay que hacer en cada etapa (o a quién se espera).
export const ETAPA_ACCION: Record<Etapa, string> = {
  pendiente_confirmar: "Revisalo y confirmalo: se le pide el pago al cliente.",
  esperando_pago: "Esperando que el cliente pague.",
  vencido: "Pasó el plazo sin pago: volvé a pedírselo o cancelalo.",
  pago_informado: "El cliente avisó que pagó: chequeá que entró al banco.",
  pendiente_pago_proveedor: "Pago verificado: falta comprarle al proveedor.",
  esperando_envio_proveedor: "Pagado al proveedor: falta que mande la entrada.",
  listo_para_enviar: "La entrada llegó: mandásela al cliente.",
  entregada: "Operación terminada.",
  reembolso_pendiente: "No se consiguió la entrada: devolvele la plata al cliente.",
  reembolsado: "Se le devolvió la plata al cliente.",
  cancelada: "Operación cancelada.",
};

export const ETAPA_COLOR: Record<Etapa, string> = {
  pendiente_confirmar: "#D14D68",
  esperando_pago: "#B07A14",
  vencido: "#9A3412",
  pago_informado: "#6C5BF2",
  pendiente_pago_proveedor: "#1F33E0",
  esperando_envio_proveedor: "#0E7490",
  listo_para_enviar: "#0D9377",
  entregada: "#171B2B",
  reembolso_pendiente: "#C2410C",
  reembolsado: "#5F6577",
  cancelada: "#9AA0AE",
};

// Las ocho del tablero, en el orden de la operación. "a_cotizar" son las
// consultas; las demás, etapas de operaciones.
export type EtapaPanel = "a_cotizar" | Exclude<Etapa, "entregada" | "reembolso_pendiente" | "reembolsado" | "cancelada">;

export const ETAPAS_PANEL: { key: EtapaPanel; label: string; color: string }[] = [
  { key: "a_cotizar", label: "A cotizar", color: "#B07A14" },
  { key: "pendiente_confirmar", label: "Pendiente de confirmar", color: ETAPA_COLOR.pendiente_confirmar },
  { key: "esperando_pago", label: "Esperando pago", color: ETAPA_COLOR.esperando_pago },
  { key: "vencido", label: "Vencidos", color: ETAPA_COLOR.vencido },
  { key: "pago_informado", label: "Pago informado", color: ETAPA_COLOR.pago_informado },
  { key: "pendiente_pago_proveedor", label: "Pendiente de pago al proveedor", color: ETAPA_COLOR.pendiente_pago_proveedor },
  { key: "esperando_envio_proveedor", label: "Esperando envío del proveedor", color: ETAPA_COLOR.esperando_envio_proveedor },
  { key: "listo_para_enviar", label: "Listo para enviar al cliente", color: ETAPA_COLOR.listo_para_enviar },
];
