import { describe, expect, it } from "vitest";
import { TX } from "./tienda-i18n";

// TKT-15: hasta que no se confirma disponibilidad con el proveedor no hay
// precio cerrado. "Estimado" es la palabra honesta; lo que sobra son los
// claims que prometen otra cosa ("precio claro", "lo que ves es lo que hay").
const es = TX.es;
const en = TX.en;
const titulos = (lang: "es" | "en") => TX[lang].porque.map(([t]) => t);
const cuerpo = (lang: "es" | "en", titulo: RegExp) =>
  TX[lang].porque.find(([t]) => titulo.test(t))?.[1] ?? "";

describe("claims de precio y stock en la tienda", () => {
  it("la bajada del hero no promete precio claro ni disponibilidad real", () => {
    expect(es.heroP).not.toMatch(/precio claro|disponibilidad real/i);
    expect(es.heroP).toMatch(/con disponibilidad y precios actualizados\.$/);
    expect(en.heroP).not.toMatch(/clear pric|real availability/i);
  });

  it("el bloque de precio se llama por lo que es: precios en dólares", () => {
    expect(titulos("es")).not.toContain("Precio claro");
    expect(titulos("es")).toContain("Precios en dólares");
    expect(cuerpo("es", /dólares/)).toBe("Sin sorpresas: todos los precios están en dólares (USD).");
    expect(titulos("en")).not.toContain("Clear pricing");
  });

  it("el bloque de stock distingue las entradas con stock de las que van a consulta", () => {
    const stock = cuerpo("es", /stock/i);
    expect(stock).not.toMatch(/lo que ves es lo que hay/i);
    expect(stock).toMatch(/con stock/);
    expect(stock).toMatch(/consulta/);
    expect(cuerpo("en", /stock/i)).not.toMatch(/what you see is what there is/i);
  });

  it("el paso 'Buscás' tampoco promete precios ni stock reales", () => {
    const paso = (lang: "es" | "en") => TX[lang].pasos[0][1];
    expect(paso("es")).not.toMatch(/reales|al momento/i);
    expect(paso("es")).toMatch(/disponibilidad y precios actualizados\.$/);
    expect(paso("en")).not.toMatch(/real prices|updated live/i);
  });

  it("el total sigue siendo estimado y dice por qué", () => {
    expect(es.carrito.total).toBe("Total estimado");
    expect(es.carrito.totalNota).toBe("Se confirma al verificar disponibilidad con el proveedor.");
    expect(en.carrito.total).toBe("Estimated total");
    expect(en.carrito.totalNota).toMatch(/supplier/);
  });
});
