import { compararAZ } from "@/lib/orden";
import { claveEvento, MAX_DESTACADOS, type Destacado } from "@/lib/destacados";
import { buildEvents, type EventoAgrupado, type Ticket } from "@/lib/tickets";

// Lo que muestra la home de la tienda (/entradas), calculado en el SERVER.
// Antes la página mandaba el catálogo entero (~2300 filas, ~900 KB) al
// navegador para mostrar dos números, 6 eventos y 8 categorías; ahora viaja
// solo esto.
//
// Orden de la página (TKT-14): buscador y categorías arriba, los destacados
// en el medio y los más próximos abajo. El agente que entró quiere comprar:
// lo primero que ve tiene que ser lo que puede comprar directo, no los
// partidos de la semana que van a consulta.
export type EventoHome = Omit<EventoAgrupado, "ubicaciones">;

export type ResumenHome = {
  totalEv: number;
  totalStock: number;
  // Bloque del medio: los curados en el panel o, sin curar, los que tienen stock.
  destacados: EventoHome[];
  // true si `destacados` es la curaduría del panel (no el respaldo automático).
  curados: boolean;
  // Bloque de abajo: los más próximos que no están ya en los destacados.
  proximos: EventoHome[];
  topCats: [string, number][];
};

const CANTIDAD = 6;

const porFecha = (a: EventoAgrupado, b: EventoAgrupado) => {
  const da = a.fecha ? Date.parse(a.fecha) : Infinity;
  const db = b.fecha ? Date.parse(b.fecha) : Infinity;
  return da - db;
};

// Sin los sectores: la home no los usa y son lo que más pesa.
const sinSectores = ({ ubicaciones: _u, ...ev }: EventoAgrupado): EventoHome => ev;

export function resumenHome(rows: Ticket[], curaduria: Destacado[] = []): ResumenHome {
  const events = buildEvents(rows);
  const totalStock = events.reduce((a, e) => a + e.bookStock, 0);

  // Destacados: los del panel que siguen en el catálogo, en su orden, con los
  // comprables primero (dentro de cada grupo se respeta el orden del panel).
  const porClave = new Map(events.map((e) => [claveEvento(e.comp, e.evento), e]));
  const elegidos = [...curaduria]
    .sort((a, b) => a.orden - b.orden)
    .map((d) => porClave.get(claveEvento(d.competicion, d.evento)))
    .filter((e): e is EventoAgrupado => !!e);
  const unicos = Array.from(new Set(elegidos)).slice(0, MAX_DESTACADOS);
  const curados = unicos.length > 0;
  const destacados = curados
    ? [...unicos.filter((e) => e.bookable > 0), ...unicos.filter((e) => e.bookable === 0)]
    : // Sin curaduría (o con todos fuera del catálogo): los comprables más próximos.
      events.filter((e) => e.bookable > 0).sort(porFecha).slice(0, CANTIDAD);

  // Próximos: los más cercanos por fecha, tengan stock o vayan a consulta, sin
  // repetir los que ya se ven arriba.
  const yaArriba = new Set(destacados);
  const proximos = events
    .filter((e) => !yaArriba.has(e))
    .sort(porFecha)
    .slice(0, CANTIDAD);

  const catCounts = new Map<string, number>();
  for (const e of events) catCounts.set(e.comp, (catCounts.get(e.comp) || 0) + 1);
  // Las 8 categorías con más eventos, mostradas en orden alfabético.
  const topCats = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .sort((a, b) => compararAZ(a[0], b[0]));

  return {
    totalEv: events.length,
    totalStock,
    destacados: destacados.map(sinSectores),
    curados,
    proximos: proximos.map(sinSectores),
    topCats,
  };
}
