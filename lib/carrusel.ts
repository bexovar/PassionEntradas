// Carrusel de eventos de la home (/), TKT-12. Curado a mano desde el panel:
// no sale del inventario. Cada tarjeta es nombre, competencia o categoría,
// mes y año, y una foto. Sin foto no hay tarjeta, y la de un mes que ya pasó
// tampoco se muestra.
//
// La home es pública y la tienda es privada: de acá NUNCA sale un precio, un
// stock ni una disponibilidad. La tarjeta no tiene dónde guardarlos.

import { hoyArgentina, imagenSegura } from "@/lib/tickets";
import { plano } from "@/lib/combo";
import { compararAZ } from "@/lib/orden";

export type TarjetaCarrusel = {
  id: string;
  nombre: string;
  categoria: string;
  // Primer día del mes del evento ("2026-11-01"): la tarjeta muestra mes y año.
  mes: string;
  // null = todavía sin foto (no se muestra en la home).
  imagen_url: string | null;
  orden: number;
};

// La home muestra entre 6 y 8. El panel deja cargar hasta MAX_CARRUSEL y
// avisa cuando hay menos de MIN_CARRUSEL listas para mostrarse.
export const MAX_CARRUSEL = 8;
export const MIN_CARRUSEL = 6;

const porOrden = (a: TarjetaCarrusel, b: TarjetaCarrusel) => a.orden - b.orden || a.id.localeCompare(b.id);

/** Ya pasó: el mes del evento es anterior al de hoy. El mes en curso sigue. */
export function mesPasado(mes: string, hoy = hoyArgentina()): boolean {
  return mes.slice(0, 7) < hoy.slice(0, 7);
}

export type EstadoTarjeta = "visible" | "sin_foto" | "vencida";

/** Por qué una tarjeta se ve o no en la home (lo que muestra el panel). */
export function estadoTarjeta(t: TarjetaCarrusel, hoy = hoyArgentina(), demo = false): EstadoTarjeta {
  if (!fotoCarruselValida(t.imagen_url, demo)) return "sin_foto";
  if (mesPasado(t.mes, hoy)) return "vencida";
  return "visible";
}

/** Lo que llega a la home: en orden, con foto, sin las vencidas, hasta 8. */
export function tarjetasVisibles(tarjetas: TarjetaCarrusel[], hoy = hoyArgentina(), demo = false): TarjetaCarrusel[] {
  return [...tarjetas]
    .sort(porOrden)
    .filter((t) => estadoTarjeta(t, hoy, demo) === "visible")
    .slice(0, MAX_CARRUSEL)
    .map((t) => ({ ...t, imagen_url: fotoCarruselValida(t.imagen_url, demo) }));
}

// Foto del carrusel: solo las subidas por el panel a nuestro bucket `carrusel`.
// En el demo también las de muestra (data URL o /carrusel-demo/ en public).
export function fotoCarruselValida(url: string | null | undefined, demo = false): string | null {
  if (demo && typeof url === "string" && /^\/carrusel-demo\/[\w.-]+$/.test(url)) return url;
  const s = imagenSegura(url);
  if (!s) return null;
  if (demo && s.startsWith("data:image/")) return s;
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/carrusel\//i.test(s) ? s : null;
}

// Sube (-1) o baja (+1) una tarjeta. Devuelve el orden nuevo de todas, o null
// si no se mueve.
export function reordenar(tarjetas: TarjetaCarrusel[], id: string, dir: 1 | -1): { id: string; orden: number }[] | null {
  const lista = [...tarjetas].sort(porOrden);
  const i = lista.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lista.length) return null;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return lista.map((t, orden) => ({ id: t.id, orden }));
}

export const MAX_NOMBRE = 120;
export const MAX_CATEGORIA = 80;

export type DatosTarjeta = Pick<TarjetaCarrusel, "nombre" | "categoria" | "mes">;

/**
 * Lo que manda el panel: nombre, categoría y mes ("2026-11" o "2026-11-15").
 * Devuelve los datos limpios (mes al día 1) o el error para mostrar.
 */
export function validarTarjeta(raw: {
  nombre?: unknown;
  categoria?: unknown;
  mes?: unknown;
}): { ok: true; value: DatosTarjeta } | { ok: false; error: string } {
  const nombre = typeof raw.nombre === "string" ? raw.nombre.trim().replace(/\s+/g, " ") : "";
  const categoria = typeof raw.categoria === "string" ? raw.categoria.trim().replace(/\s+/g, " ") : "";
  const mesTxt = typeof raw.mes === "string" ? raw.mes.trim() : "";
  if (!nombre) return { ok: false, error: "Falta el nombre del evento" };
  if (nombre.length > MAX_NOMBRE) return { ok: false, error: `El nombre tiene más de ${MAX_NOMBRE} caracteres` };
  if (!categoria) return { ok: false, error: "Falta la competencia o categoría" };
  if (categoria.length > MAX_CATEGORIA) {
    return { ok: false, error: `La categoría tiene más de ${MAX_CATEGORIA} caracteres` };
  }
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(mesTxt);
  const mesNum = m ? Number(m[2]) : 0;
  if (!m || mesNum < 1 || mesNum > 12) return { ok: false, error: "Elegí el mes y el año" };
  return { ok: true, value: { nombre, categoria, mes: `${m[1]}-${m[2]}-01` } };
}

// Un evento que ya está en el catálogo, para elegirlo en el form del panel:
// al elegirlo se completan nombre, competición y mes. La tarjeta guarda una
// copia (el carrusel sigue curado a mano: se puede editar o escribir otro).
export type EventoCatalogo = {
  clave: string;
  nombre: string;
  categoria: string;
  // Primer día del mes ("2026-11-01"); null si el evento no tiene fecha.
  mes: string | null;
  // Día del evento ("2026-11-11"), para mostrarlo en la sugerencia.
  fecha: string | null;
};

const normalizado = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Los eventos vigentes del catálogo, uno por nombre y día (un evento tiene una
 * fila por sector): por fecha y, el mismo día, por nombre; los sin fecha al
 * final. `hoy` es el día argentino ("2026-10-31"): los anteriores no entran.
 */
export function eventosParaCarrusel(
  tickets: { evento: string | null; competicion: string | null; fecha: string | null }[],
  hoy = hoyArgentina()
): EventoCatalogo[] {
  const porClave = new Map<string, EventoCatalogo>();
  for (const t of tickets) {
    const nombre = normalizado(t.evento ?? "");
    if (!nombre) continue;
    const fecha = t.fecha ? t.fecha.slice(0, 10) : null;
    if (fecha && fecha < hoy) continue;
    const clave = `${nombre.toLowerCase()}|${fecha ?? ""}`;
    if (porClave.has(clave)) continue;
    porClave.set(clave, {
      clave,
      nombre,
      categoria: normalizado(t.competicion ?? ""),
      mes: fecha ? `${fecha.slice(0, 7)}-01` : null,
      fecha,
    });
  }
  return Array.from(porClave.values()).sort(
    (a, b) =>
      (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") ||
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
  );
}

/**
 * Lo que ofrece el form del carrusel: los eventos vigentes y sus
 * competiciones (A-Z, sin repetir "Formula 1" / "Fórmula 1"). Con Passion
 * apagado, solo lo propio: lo mismo que ve la tienda.
 */
export function opcionesDelCatalogo(
  catalogo: { evento: string | null; competicion: string | null; fecha: string | null; source: string }[],
  portalActivo: boolean,
  hoy = hoyArgentina()
): { eventos: EventoCatalogo[]; competiciones: string[] } {
  const visibles = portalActivo ? catalogo : catalogo.filter((t) => t.source !== "portal");
  // Por competición, la primera forma en que aparece en el catálogo.
  const competiciones = new Map<string, string>();
  for (const t of visibles) {
    const c = normalizado(t.competicion ?? "");
    if (!c || (t.fecha && t.fecha.slice(0, 10) < hoy)) continue;
    if (!competiciones.has(plano(c))) competiciones.set(plano(c), c);
  }
  return {
    eventos: eventosParaCarrusel(visibles, hoy),
    competiciones: Array.from(competiciones.values()).sort(compararAZ),
  };
}

/** "NOV" + "2026", y "Noviembre 2026" para lectores de pantalla. */
export function mesLegible(mes: string, lang: "es" | "en" = "es"): { mes: string; anio: string; completo: string } {
  const d = new Date(`${mes.slice(0, 7)}-01T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { mes: "", anio: "", completo: "" };
  const locale = lang === "en" ? "en-US" : "es-AR";
  const corto = d.toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", "").toUpperCase();
  const anio = String(d.getUTCFullYear());
  const largo = d.toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  return { mes: corto, anio, completo: `${largo.charAt(0).toUpperCase()}${largo.slice(1)} ${anio}` };
}
