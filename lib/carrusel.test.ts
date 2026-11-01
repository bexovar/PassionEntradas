import { describe, expect, it } from "vitest";
import {
  estadoTarjeta,
  fotoCarruselValida,
  MAX_CARRUSEL,
  mesLegible,
  mesPasado,
  reordenar,
  tarjetasVisibles,
  validarTarjeta,
  type TarjetaCarrusel,
} from "./carrusel";

// La home es pública: estos tests fijan qué tarjeta entra al carrusel y que lo
// que viaja al navegador no lleva nada de precio, stock ni disponibilidad.

const HOY = "2026-10-31";
const FOTO = "https://abc.supabase.co/storage/v1/object/public/carrusel/x.webp";

function tarjeta(id: string, extra: Partial<TarjetaCarrusel> = {}): TarjetaCarrusel {
  return { id, nombre: `Evento ${id}`, categoria: "Fútbol", mes: "2026-12-01", imagen_url: FOTO, orden: 0, ...extra };
}

describe("tarjetasVisibles", () => {
  it("van en el orden del panel", () => {
    const r = tarjetasVisibles([tarjeta("b", { orden: 1 }), tarjeta("a", { orden: 0 }), tarjeta("c", { orden: 2 })], HOY);
    expect(r.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("sin foto no hay tarjeta (nada de placeholders)", () => {
    const r = tarjetasVisibles([tarjeta("a", { imagen_url: null }), tarjeta("b")], HOY);
    expect(r.map((t) => t.id)).toEqual(["b"]);
  });

  it("una foto que no es de nuestro bucket tampoco cuenta", () => {
    const r = tarjetasVisibles([tarjeta("a", { imagen_url: "https://otro.com/x.jpg" })], HOY);
    expect(r).toEqual([]);
  });

  it("la de un mes que ya pasó no se muestra; la del mes en curso sí", () => {
    const r = tarjetasVisibles(
      [tarjeta("vieja", { mes: "2026-09-01" }), tarjeta("este-mes", { mes: "2026-10-01" })],
      HOY
    );
    expect(r.map((t) => t.id)).toEqual(["este-mes"]);
  });

  it("como mucho 8", () => {
    const muchas = Array.from({ length: 11 }, (_, i) => tarjeta(`t${i}`, { orden: i }));
    expect(tarjetasVisibles(muchas, HOY)).toHaveLength(MAX_CARRUSEL);
  });

  it("lo que viaja es solo lo que muestra la tarjeta", () => {
    const [t] = tarjetasVisibles([tarjeta("a")], HOY);
    expect(Object.keys(t).sort()).toEqual(["categoria", "id", "imagen_url", "mes", "nombre", "orden"]);
    expect(JSON.stringify(t)).not.toMatch(/precio|stock|dispon/i);
  });
});

describe("estadoTarjeta (lo que ve el panel)", () => {
  it("dice por qué no se muestra", () => {
    expect(estadoTarjeta(tarjeta("a"), HOY)).toBe("visible");
    expect(estadoTarjeta(tarjeta("a", { imagen_url: null }), HOY)).toBe("sin_foto");
    expect(estadoTarjeta(tarjeta("a", { mes: "2026-01-01" }), HOY)).toBe("vencida");
  });
});

describe("mesPasado", () => {
  it("compara por mes, no por día", () => {
    expect(mesPasado("2026-10-01", "2026-10-31")).toBe(false);
    expect(mesPasado("2026-09-01", "2026-10-01")).toBe(true);
    expect(mesPasado("2027-01-01", "2026-12-31")).toBe(false);
  });
});

describe("fotoCarruselValida", () => {
  it("solo nuestro bucket", () => {
    expect(fotoCarruselValida(FOTO)).toBe(FOTO);
    expect(fotoCarruselValida("https://abc.supabase.co/storage/v1/object/public/mapas/x.webp")).toBeNull();
    expect(fotoCarruselValida("javascript:alert(1)")).toBeNull();
    expect(fotoCarruselValida(null)).toBeNull();
  });

  it("en el demo, también las de muestra", () => {
    expect(fotoCarruselValida("/carrusel-demo/f1.svg", true)).toBe("/carrusel-demo/f1.svg");
    expect(fotoCarruselValida("/carrusel-demo/f1.svg")).toBeNull();
    expect(fotoCarruselValida("/carrusel-demo/../secreto", true)).toBeNull();
  });
});

describe("reordenar", () => {
  const lista = [tarjeta("a", { orden: 0 }), tarjeta("b", { orden: 1 }), tarjeta("c", { orden: 2 })];

  it("sube y baja una tarjeta", () => {
    expect(reordenar(lista, "b", -1)).toEqual([
      { id: "b", orden: 0 },
      { id: "a", orden: 1 },
      { id: "c", orden: 2 },
    ]);
    expect(reordenar(lista, "b", 1)?.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("no se sale de la lista", () => {
    expect(reordenar(lista, "a", -1)).toBeNull();
    expect(reordenar(lista, "c", 1)).toBeNull();
    expect(reordenar(lista, "zz", 1)).toBeNull();
  });
});

describe("validarTarjeta", () => {
  it("limpia y lleva el mes al día 1", () => {
    expect(validarTarjeta({ nombre: "  Final   Mundial ", categoria: "Mundial 2026", mes: "2026-07" })).toEqual({
      ok: true,
      value: { nombre: "Final Mundial", categoria: "Mundial 2026", mes: "2026-07-01" },
    });
    expect(validarTarjeta({ nombre: "GP Monza", categoria: "Fórmula 1", mes: "2026-09-06" })).toMatchObject({
      ok: true,
      value: { mes: "2026-09-01" },
    });
  });

  it("pide lo que falta", () => {
    expect(validarTarjeta({ nombre: "", categoria: "x", mes: "2026-07" })).toMatchObject({ ok: false });
    expect(validarTarjeta({ nombre: "x", categoria: " ", mes: "2026-07" })).toMatchObject({ ok: false });
    expect(validarTarjeta({ nombre: "x", categoria: "y", mes: "2026-13" })).toMatchObject({ ok: false });
    expect(validarTarjeta({ nombre: "x", categoria: "y", mes: "julio" })).toMatchObject({ ok: false });
    expect(validarTarjeta({ nombre: "x".repeat(200), categoria: "y", mes: "2026-07" })).toMatchObject({ ok: false });
  });
});

describe("mesLegible", () => {
  it("mes y año, sin correrse de mes", () => {
    expect(mesLegible("2026-11-01")).toEqual({ mes: "NOV", anio: "2026", completo: "Noviembre 2026" });
    expect(mesLegible("2026-01-01", "en")).toEqual({ mes: "JAN", anio: "2026", completo: "January 2026" });
  });
});
