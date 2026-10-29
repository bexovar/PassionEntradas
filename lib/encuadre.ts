// Encuadre de las fotos del carrusel (components/admin/EncuadreFoto). El admin
// elige qué parte de la foto entra en un marco fijo 4:3 arrastrando y con zoom;
// el navegador recorta eso y lo sube a 1200×900. Acá va solo la cuenta, sin
// DOM, para poder testearla.
//
// Unidades: el marco mide MARCO.w × MARCO.h unidades lógicas (el componente lo
// escala al ancho real). `x`, `y` es la esquina superior izquierda de la foto
// dentro del marco (≤ 0: la foto siempre cubre todo el marco). `zoom` es
// relativo al tamaño que cubre el marco justo: 1 = lo más alejado posible.

export const MARCO = { w: 400, h: 300 } as const;
export const SALIDA = { w: 1200, h: 900 } as const;
export const MIN_LADO = 800;
export const ZOOM_MAX = 3;

export type Tamano = { w: number; h: number };
export type Encuadre = { zoom: number; x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

// Más chica que esto se ve pixelada en la tarjeta.
export function fotoMuyChica(img: Tamano): boolean {
  return img.w < MIN_LADO || img.h < MIN_LADO;
}

// Unidades del marco por píxel de la foto.
function escala(img: Tamano, zoom: number): number {
  return Math.max(MARCO.w / img.w, MARCO.h / img.h) * zoom;
}

// Tamaño de la foto dentro del marco, en unidades del marco (para el CSS).
export function tamanoEnMarco(img: Tamano, zoom: number): Tamano {
  const s = escala(img, zoom);
  return { w: img.w * s, h: img.h * s };
}

const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Corrige el encuadre para que la foto cubra el marco sin huecos.
export function limitar(img: Tamano, e: Encuadre): Encuadre {
  const zoom = entre(e.zoom, 1, ZOOM_MAX);
  const t = tamanoEnMarco(img, zoom);
  return { zoom, x: entre(e.x, MARCO.w - t.w, 0), y: entre(e.y, MARCO.h - t.h, 0) };
}

export function centrar(img: Tamano): Encuadre {
  const t = tamanoEnMarco(img, 1);
  return { zoom: 1, x: (MARCO.w - t.w) / 2, y: (MARCO.h - t.h) / 2 };
}

export function mover(img: Tamano, e: Encuadre, dx: number, dy: number): Encuadre {
  return limitar(img, { ...e, x: e.x + dx, y: e.y + dy });
}

// Cambia el zoom dejando quieto el punto de la foto que está en el centro del marco.
export function zoomear(img: Tamano, e: Encuadre, zoom: number): Encuadre {
  const z = entre(zoom, 1, ZOOM_MAX);
  const k = z / e.zoom;
  const cx = MARCO.w / 2;
  const cy = MARCO.h / 2;
  return limitar(img, { zoom: z, x: cx - (cx - e.x) * k, y: cy - (cy - e.y) * k });
}

// La parte de la foto (en píxeles de la foto) que se ve en el marco.
export function rectRecorte(img: Tamano, e: Encuadre): Rect {
  const s = escala(img, e.zoom);
  const w = Math.min(img.w, MARCO.w / s);
  const h = Math.min(img.h, MARCO.h / s);
  return { x: entre(-e.x / s, 0, img.w - w), y: entre(-e.y / s, 0, img.h - h), w, h };
}
