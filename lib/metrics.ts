import type { Operacion } from "@/lib/operaciones";

// Métricas del negocio para el tablero del módulo de carga.
//
// Criterio: la plata "se movió" cuando el pago está confirmado (incluye
// operaciones ya cerradas). Las canceladas no cuentan nunca, aunque hayan
// tenido pago en algún momento. "En juego" es la exposición actual: monto
// comprometido en operaciones abiertas que todavía no cobraron.

export type Metrics = {
  // Con varias monedas no tiene sentido un pozo único: las métricas son de
  // UNA moneda, la de mayor movimiento. El tablero la muestra en las
  // etiquetas para que no se lea un número sin unidad.
  moneda: string;
  plataMovida: number; // suma de monto con pago confirmado
  comisionGanada: number; // suma de fee de esas operaciones
  entradasVendidas: number; // entradas (suma de cantidades) con pago confirmado
  enJuegoMonto: number; // monto comprometido en operaciones abiertas sin pago
  enJuegoOps: number; // cuántas operaciones abiertas sin pago
  ticketPromedio: number; // plataMovida / entradasVendidas: precio medio por entrada
  // Las otras monedas con movimiento (mismos campos, cada una en la suya).
  // El tablero las muestra en pestañas: pesos y dólares nunca se suman.
  otrasMonedas?: Metrics[];
};

type OpMetrica = Pick<
  Operacion,
  "monto" | "fee" | "status" | "pago_confirmado_at" | "cerrada_at" | "moneda"
> & {
  cantidad?: number | null;
  tipo?: Operacion["tipo"] | null;
  confirmada_at?: string | null;
  reembolso_at?: string | null;
};

// Día (YYYY-MM-DD) en hora argentina: un pago confirmado a las 22 h de
// Buenos Aires ya es el día siguiente en UTC, y caía en el rango equivocado.
export function diaAr(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(
    new Date(iso)
  );
}

// Rango opcional (fechas YYYY-MM-DD, inclusive): filtra las métricas de
// venta por el DÍA en que se confirmó el pago, en hora argentina. "En juego"
// no depende del rango (es exposición actual).
//
// Agrupa por moneda y devuelve la dominante, igual que el RPC: sumar pesos
// con dólares en un solo pozo y etiquetarlo con la moneda de la primera
// operación daba un número que no significaba nada (y mentía sobre la unidad).
//
// Es el mismo criterio que el RPC `metricas_operaciones` (migraciones 0035, 0040 y 0059):
// producción calcula en la base y el modo demo acá, y tienen que coincidir.
export function computeMetrics(
  ops: OpMetrica[],
  desde?: string | null,
  hasta?: string | null
): Metrics {
  type Acum = {
    moneda: string;
    plata_movida: number;
    comision_ganada: number;
    entradas_vendidas: number;
    en_juego_monto: number;
    en_juego_ops: number;
  };
  const porMoneda = new Map<string, Acum>();
  const acum = (moneda: string): Acum => {
    let a = porMoneda.get(moneda);
    if (!a) {
      a = {
        moneda,
        plata_movida: 0,
        comision_ganada: 0,
        entradas_vendidas: 0,
        en_juego_monto: 0,
        en_juego_ops: 0,
      };
      porMoneda.set(moneda, a);
    }
    return a;
  };

  for (const op of ops) {
    // Un reembolso (pendiente o hecho) no es venta ni plata en juego, igual
    // que una cancelada: el cliente pagó, pero la plata vuelve (0059).
    if (op.status === "cancelada" || op.reembolso_at) continue;
    const a = acum(op.moneda ?? "USD");

    if (op.pago_confirmado_at) {
      const dia = diaAr(op.pago_confirmado_at);
      if (desde && dia < desde) continue;
      if (hasta && dia > hasta) continue;
      a.plata_movida += op.monto;
      a.comision_ganada += op.fee;
      a.entradas_vendidas += op.cantidad && op.cantidad > 0 ? op.cantidad : 1;
    } else if (!op.cerrada_at && !(op.tipo === "pedido" && !op.confirmada_at)) {
      // Un pedido de la tienda sin confirmar todavía no es plata comprometida.
      a.en_juego_monto += op.monto;
      a.en_juego_ops += 1;
    }
  }

  return metricasDominantes(Array.from(porMoneda.values()));
}


// El RPC devuelve una fila por moneda. La principal es USD si tuvo
// movimiento (es la moneda de casi todo el negocio); si no, la de más
// operaciones. Las demás van en `otrasMonedas` para verlas por separado.
// Antes se elegía "la de mayor plata movida" comparando montos crudos: un
// pedido de $ 1.200.000 le ganaba a US$ 50.000 y el tablero pasaba a pesos
// mostrando los montos con "US$" adelante.
type FilaMoneda = {
  moneda?: string | null;
  plata_movida?: number | null;
  comision_ganada?: number | null;
  entradas_vendidas?: number | null;
  en_juego_monto?: number | null;
  en_juego_ops?: number | null;
};

function aMetrics(m: FilaMoneda): Metrics {
  const plataMovida = Number(m.plata_movida ?? 0);
  const entradasVendidas = Number(m.entradas_vendidas ?? 0);
  return {
    moneda: m.moneda ?? "USD",
    plataMovida,
    comisionGanada: Number(m.comision_ganada ?? 0),
    entradasVendidas,
    enJuegoMonto: Number(m.en_juego_monto ?? 0),
    enJuegoOps: Number(m.en_juego_ops ?? 0),
    ticketPromedio: entradasVendidas > 0 ? Math.round(plataMovida / entradasVendidas) : 0,
  };
}

export function metricasDominantes(filas: FilaMoneda[]): Metrics {
  const todas = (filas ?? []).map(aMetrics);
  const actividad = (m: Metrics) => m.entradasVendidas + m.enJuegoOps;
  const principal =
    todas.find((m) => m.moneda === "USD" && actividad(m) > 0) ??
    [...todas].sort((a, b) => actividad(b) - actividad(a))[0] ??
    aMetrics({});
  const otras = todas.filter((m) => m !== principal && actividad(m) > 0);
  return { ...principal, otrasMonedas: otras };
}
