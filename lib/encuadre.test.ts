import { describe, expect, it } from "vitest";
import {
  MARCO,
  ZOOM_MAX,
  centrar,
  fotoMuyChica,
  limitar,
  mover,
  rectRecorte,
  zoomear,
  type Encuadre,
} from "./encuadre";

// El editor de fotos del carrusel: el marco 4:3 siempre queda lleno (sin
// huecos), y lo que se ve en el marco es exactamente lo que se recorta.

const VERTICAL = { w: 1000, h: 2000 };
const PANORAMICA = { w: 3200, h: 1000 };

// Tamaño que ocupa la foto en el marco con un encuadre dado.
function tamano(img: { w: number; h: number }, e: Encuadre) {
  const s = Math.max(MARCO.w / img.w, MARCO.h / img.h) * e.zoom;
  return { w: img.w * s, h: img.h * s };
}

function cubreElMarco(img: { w: number; h: number }, e: Encuadre) {
  const t = tamano(img, e);
  return e.x <= 0 && e.y <= 0 && e.x + t.w >= MARCO.w - 1e-9 && e.y + t.h >= MARCO.h - 1e-9;
}

describe("centrar", () => {
  it("con zoom 1 la foto cubre el marco justo por su lado más corto", () => {
    const e = centrar(VERTICAL);
    expect(e.zoom).toBe(1);
    expect(tamano(VERTICAL, e).w).toBeCloseTo(MARCO.w);
    expect(e.x).toBeCloseTo(0);
    expect(cubreElMarco(VERTICAL, e)).toBe(true);
  });

  it("una panorámica queda centrada a lo ancho", () => {
    const e = centrar(PANORAMICA);
    expect(tamano(PANORAMICA, e).h).toBeCloseTo(MARCO.h);
    expect(e.y).toBeCloseTo(0);
    expect(e.x).toBeCloseTo((MARCO.w - tamano(PANORAMICA, e).w) / 2);
  });
});

describe("mover", () => {
  it("el arrastre no deja huecos en ningún borde", () => {
    const e0 = centrar(PANORAMICA);
    for (const [dx, dy] of [[5000, 0], [-5000, 0], [0, 5000], [0, -5000], [999, -999]]) {
      expect(cubreElMarco(PANORAMICA, mover(PANORAMICA, e0, dx, dy))).toBe(true);
    }
  });

  it("arrastrar a la derecha hasta el tope muestra el borde izquierdo de la foto", () => {
    const e = mover(PANORAMICA, centrar(PANORAMICA), 1e6, 0);
    expect(e.x).toBe(0);
  });
});

describe("zoomear", () => {
  it("no baja de 1 (siempre cubre) ni pasa del máximo", () => {
    const e0 = centrar(VERTICAL);
    expect(zoomear(VERTICAL, e0, 0.2).zoom).toBe(1);
    expect(zoomear(VERTICAL, e0, 99).zoom).toBe(ZOOM_MAX);
  });

  it("acerca sobre el centro del marco y sigue cubriendo al alejar", () => {
    const e0 = centrar(VERTICAL);
    const cerca = zoomear(VERTICAL, e0, 2);
    // El punto de la foto que estaba en el centro del marco sigue ahí.
    const centroAntes = rectRecorte(VERTICAL, e0);
    const centroDespues = rectRecorte(VERTICAL, cerca);
    expect(centroDespues.x + centroDespues.w / 2).toBeCloseTo(centroAntes.x + centroAntes.w / 2);
    expect(centroDespues.y + centroDespues.h / 2).toBeCloseTo(centroAntes.y + centroAntes.h / 2);
    // Movida a una esquina y alejada: no aparecen huecos.
    const esquina = mover(VERTICAL, cerca, 1e6, 1e6);
    expect(cubreElMarco(VERTICAL, zoomear(VERTICAL, esquina, 1))).toBe(true);
  });
});

describe("limitar", () => {
  it("corrige un encuadre que deja huecos", () => {
    const e = limitar(PANORAMICA, { zoom: 1, x: 50, y: 20 });
    expect(cubreElMarco(PANORAMICA, e)).toBe(true);
  });
});

describe("rectRecorte", () => {
  it("una vertical centrada recorta todo el ancho y una franja 4:3 del medio", () => {
    const r = rectRecorte(VERTICAL, centrar(VERTICAL));
    expect(r.x).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(1000);
    expect(r.h).toBeCloseTo(750);
    expect(r.y).toBeCloseTo((2000 - 750) / 2);
  });

  it("una panorámica centrada recorta todo el alto y el centro 4:3", () => {
    const r = rectRecorte(PANORAMICA, centrar(PANORAMICA));
    expect(r.h).toBeCloseTo(1000);
    expect(r.w).toBeCloseTo(1000 * (4 / 3));
    expect(r.x).toBeCloseTo((3200 - r.w) / 2);
  });

  it("con zoom 2 recorta la mitad de cada lado", () => {
    const e = zoomear(PANORAMICA, centrar(PANORAMICA), 2);
    const r = rectRecorte(PANORAMICA, e);
    expect(r.h).toBeCloseTo(500);
    expect(r.w / r.h).toBeCloseTo(4 / 3);
  });

  it("el recorte nunca sale de la foto", () => {
    const e = mover(VERTICAL, zoomear(VERTICAL, centrar(VERTICAL), 3), -1e6, -1e6);
    const r = rectRecorte(VERTICAL, e);
    expect(r.x + r.w).toBeLessThanOrEqual(1000 + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(2000 + 1e-6);
  });
});

describe("fotoMuyChica", () => {
  it("rechaza menos de 800 px de ancho o de alto", () => {
    expect(fotoMuyChica({ w: 600, h: 450 })).toBe(true);
    expect(fotoMuyChica({ w: 1600, h: 700 })).toBe(true);
    expect(fotoMuyChica({ w: 799, h: 1200 })).toBe(true);
    expect(fotoMuyChica({ w: 800, h: 800 })).toBe(false);
    expect(fotoMuyChica({ w: 4000, h: 3000 })).toBe(false);
  });
});
