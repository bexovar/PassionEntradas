// Carrusel de eventos de la home (/). Sale del catálogo real: el admin solo
// sube fotos, y un evento sin foto (propia ni de su competición) no aparece.
//
// La home es pública y la tienda es privada: de acá NUNCA sale un precio. La
// tarjeta lleva solo lo que se ve (nombre, competición, fecha, sede, foto), así
// que nada de precio llega al HTML ni al payload del cliente.

import { eventoPasado, hoyArgentina, imagenSegura, type EventoAgrupado } from "@/lib/tickets";

export type FotoCarrusel = {
  id: string;
  competicion: string;
  // null = foto de toda la competición (la usan los partidos sin foto propia).
  evento: string | null;
  imagen_url: string;
  orden: number;
};

export type TarjetaCarrusel = {
  clave: string;
  evento: string;
  competicion: string;
  fecha: string | null;
  ciudad: string | null;
  imagen: string;
};

export const MAX_CARRUSEL = 12;
// Tope de fotos por competición o por evento (lo controla la API).
export const MAX_FOTOS_POR_GRUPO = 10;

// Lo que el panel necesita de cada evento del catálogo (sin precios).
export type EventoCatalogo = Pick<EventoAgrupado, "comp" | "evento" | "fecha">;

const porOrden = (a: FotoCarrusel, b: FotoCarrusel) => a.orden - b.orden || a.id.localeCompare(b.id);

// Sin fecha al final: primero lo que está más cerca.
function porFecha(a: EventoCatalogo, b: EventoCatalogo): number {
  if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
  if (a.fecha) return -1;
  if (b.fecha) return 1;
  return a.evento.localeCompare(b.evento);
}

export function eventosCarrusel(
  eventos: EventoAgrupado[],
  fotos: FotoCarrusel[],
  max = MAX_CARRUSEL,
  hoy = hoyArgentina()
): TarjetaCarrusel[] {
  const propias = new Map<string, FotoCarrusel[]>();
  const deCompeticion = new Map<string, FotoCarrusel[]>();
  for (const f of [...fotos].sort(porOrden)) {
    const mapa = f.evento ? propias : deCompeticion;
    const clave = f.evento ? `${f.competicion}__${f.evento}` : f.competicion;
    mapa.set(clave, [...(mapa.get(clave) ?? []), f]);
  }

  // Los partidos que usan las fotos de su competición las van alternando en
  // orden de fecha (1, 2, 3, 1…): así no se repite la misma imagen seguida, y
  // el reparto sale igual en cada visita.
  const usadas = new Map<string, number>();
  const tarjetas: TarjetaCarrusel[] = [];
  for (const ev of [...eventos].sort(porFecha)) {
    if (eventoPasado(ev.fecha, hoy)) continue;
    const clave = `${ev.comp}__${ev.evento}`;
    let foto = propias.get(clave)?.[0];
    if (!foto) {
      const comp = deCompeticion.get(ev.comp);
      if (!comp?.length) continue;
      const n = usadas.get(ev.comp) ?? 0;
      usadas.set(ev.comp, n + 1);
      foto = comp[n % comp.length];
    }
    tarjetas.push({
      clave,
      evento: ev.evento,
      competicion: ev.comp,
      fecha: ev.fecha,
      ciudad: ev.ciudad,
      imagen: foto.imagen_url,
    });
  }
  return tarjetas.slice(0, max);
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

// ---- panel de admin ("Fotos del carrusel") ----------------------------------

export type EstadoFotoEvento = "propias" | "competicion" | "sin_foto";

export type PanelCarrusel = {
  competiciones: {
    competicion: string;
    fotos: FotoCarrusel[];
    eventos: (EventoCatalogo & { fotos: FotoCarrusel[]; estado: EstadoFotoEvento })[];
  }[];
  // Fotos propias de eventos que ya pasaron o salieron del catálogo: no se
  // muestran y el panel ofrece borrarlas. Las de competición no vencen.
  vencidas: FotoCarrusel[];
};

export function panelCarrusel(eventos: EventoCatalogo[], fotos: FotoCarrusel[], hoy = hoyArgentina()): PanelCarrusel {
  const vigentes = eventos.filter((e) => !eventoPasado(e.fecha, hoy)).sort(porFecha);
  const claves = new Set(vigentes.map((e) => `${e.comp}__${e.evento}`));
  const ordenadas = [...fotos].sort(porOrden);
  const nombres = new Set([...vigentes.map((e) => e.comp), ...ordenadas.map((f) => f.competicion)]);

  const competiciones = Array.from(nombres).sort((a, b) => a.localeCompare(b)).map((competicion) => {
    const deComp = ordenadas.filter((f) => f.competicion === competicion && !f.evento);
    return {
      competicion,
      fotos: deComp,
      eventos: vigentes
        .filter((e) => e.comp === competicion)
        .map((e) => {
          const propias = ordenadas.filter((f) => f.competicion === competicion && f.evento === e.evento);
          const estado: EstadoFotoEvento = propias.length ? "propias" : deComp.length ? "competicion" : "sin_foto";
          return { ...e, fotos: propias, estado };
        }),
    };
  });
  const vencidas = ordenadas.filter((f) => f.evento && !claves.has(`${f.competicion}__${f.evento}`));
  return { competiciones, vencidas };
}

// Sube (-1) o baja (+1) una foto dentro de su grupo (misma competición y
// evento). Devuelve el orden nuevo de todo el grupo, o null si no se mueve.
export function reordenar(fotos: FotoCarrusel[], id: string, dir: 1 | -1): { id: string; orden: number }[] | null {
  const foto = fotos.find((f) => f.id === id);
  if (!foto) return null;
  const grupo = fotos
    .filter((f) => f.competicion === foto.competicion && f.evento === foto.evento)
    .sort(porOrden);
  const i = grupo.indexOf(foto);
  const j = i + dir;
  if (j < 0 || j >= grupo.length) return null;
  [grupo[i], grupo[j]] = [grupo[j], grupo[i]];
  return grupo.map((f, orden) => ({ id: f.id, orden }));
}

const MAX_NOMBRE = 200;

// Competición y evento que manda el panel. Evento vacío = foto de toda la competición.
export function grupoValido(competicion: unknown, evento: unknown): { competicion: string; evento: string | null } | null {
  if (typeof competicion !== "string") return null;
  if (evento != null && typeof evento !== "string") return null;
  const c = competicion.trim();
  const e = (evento ?? "").trim();
  if (!c || c.length > MAX_NOMBRE || e.length > MAX_NOMBRE) return null;
  return { competicion: c, evento: e || null };
}
