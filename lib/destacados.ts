// Eventos destacados de la tienda (TKT-14): el bloque del medio de /entradas,
// curado a mano desde /admin/configuracion. Un destacado apunta a un evento
// del catálogo por competición + nombre, la misma clave con la que la tienda
// agrupa los sectores (lib/tickets.ts → buildEvents).

export type Destacado = {
  id: string;
  competicion: string;
  evento: string;
  orden: number;
};

export type DatosDestacado = Pick<Destacado, "competicion" | "evento">;

// Un evento elegible: lo que ofrece el panel para destacar.
export type EventoDestacable = DatosDestacado & { fecha: string | null; conStock: boolean };

export const MAX_DESTACADOS = 6;

const limpio = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");

/** La clave con la que se cruza un destacado con un evento de la tienda. */
export function claveEvento(competicion: string, evento: string): string {
  return `${limpio(competicion).toLowerCase()}__${limpio(evento).toLowerCase()}`;
}

export function validarDestacado(raw: {
  competicion?: unknown;
  evento?: unknown;
}): { ok: true; value: DatosDestacado } | { ok: false; error: string } {
  const competicion = limpio(raw.competicion);
  const evento = limpio(raw.evento);
  if (!evento) return { ok: false, error: "Elegí un evento del catálogo" };
  if (!competicion) return { ok: false, error: "Falta la competición del evento" };
  if (competicion.length > 200 || evento.length > 300) return { ok: false, error: "Nombre demasiado largo" };
  return { ok: true, value: { competicion, evento } };
}

const porOrden = (a: Destacado, b: Destacado) => a.orden - b.orden;

/** Sube o baja uno; devuelve el orden nuevo de todos, o null si no se mueve. */
export function reordenarDestacados(
  lista: Destacado[],
  id: string,
  dir: 1 | -1
): { id: string; orden: number }[] | null {
  const ordenada = [...lista].sort(porOrden);
  const i = ordenada.findIndex((d) => d.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordenada.length) return null;
  [ordenada[i], ordenada[j]] = [ordenada[j], ordenada[i]];
  return ordenada.map((d, orden) => ({ id: d.id, orden }));
}

/**
 * Los eventos vigentes del catálogo, uno por competición + nombre, para
 * elegir en el panel: por fecha (los sin fecha al final).
 */
export function eventosDestacables(
  tickets: {
    evento: string | null;
    competicion: string | null;
    fecha: string | null;
    source: string;
    estado?: string | null;
    stock?: number | null;
    precio_final?: number | string | null;
  }[],
  portalActivo: boolean,
  hoy: string
): EventoDestacable[] {
  const porClave = new Map<string, EventoDestacable>();
  for (const t of tickets) {
    if (!portalActivo && t.source === "portal") continue;
    const evento = limpio(t.evento);
    if (!evento) continue;
    const fecha = t.fecha ? t.fecha.slice(0, 10) : null;
    if (fecha && fecha < hoy) continue;
    // Misma regla que buildEvents: sin competición, "Otros".
    const competicion = limpio(t.competicion) || "Otros";
    // Mismo criterio que buildEvents para "comprable": stock + book + precio.
    const conStock = t.estado === "book" && (t.stock ?? 0) > 0 && Number(t.precio_final) > 0;
    const clave = claveEvento(competicion, evento);
    const previo = porClave.get(clave);
    if (previo) {
      previo.conStock ||= conStock;
      if (!previo.fecha && fecha) previo.fecha = fecha;
      continue;
    }
    porClave.set(clave, { competicion, evento, fecha, conStock });
  }
  return Array.from(porClave.values()).sort(
    (a, b) =>
      (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") ||
      a.evento.localeCompare(b.evento, "es", { sensitivity: "base" })
  );
}
