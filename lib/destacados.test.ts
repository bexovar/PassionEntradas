import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eventosDestacables, reordenarDestacados, validarDestacado, type Destacado } from "@/lib/destacados";

describe("destacados de la tienda", () => {
  it("valida y limpia lo que manda el panel", () => {
    expect(validarDestacado({ competicion: " Liga  Profesional ", evento: "Boca  vs River" })).toEqual({
      ok: true,
      value: { competicion: "Liga Profesional", evento: "Boca vs River" },
    });
    expect(validarDestacado({ competicion: "Liga", evento: "" }).ok).toBe(false);
    expect(validarDestacado({ competicion: "", evento: "Boca" }).ok).toBe(false);
    expect(validarDestacado({ competicion: 3, evento: {} }).ok).toBe(false);
  });

  it("sube y baja; en los bordes no se mueve", () => {
    const lista: Destacado[] = [
      { id: "a", competicion: "L", evento: "A", orden: 0 },
      { id: "b", competicion: "L", evento: "B", orden: 1 },
      { id: "c", competicion: "L", evento: "C", orden: 2 },
    ];
    expect(reordenarDestacados(lista, "c", -1)).toEqual([
      { id: "a", orden: 0 },
      { id: "c", orden: 1 },
      { id: "b", orden: 2 },
    ]);
    expect(reordenarDestacados(lista, "a", -1)).toBeNull();
    expect(reordenarDestacados(lista, "c", 1)).toBeNull();
    expect(reordenarDestacados(lista, "x", 1)).toBeNull();
  });

  it("el panel ofrece un evento por competición + nombre, vigente, con su stock", () => {
    const base = { source: "manual" };
    const evs = eventosDestacables(
      [
        { ...base, evento: "Boca vs River", competicion: "Liga", fecha: "2030-03-01", estado: "on_request", stock: 0, precio_final: null },
        { ...base, evento: "Boca vs River", competicion: "Liga", fecha: "2030-03-01", estado: "book", stock: 3, precio_final: 100 },
        { ...base, evento: "Ya jugado", competicion: "Liga", fecha: "2020-01-01", estado: "book", stock: 3, precio_final: 100 },
        { ...base, evento: "Sin precio", competicion: null, fecha: "2030-01-01", estado: "book", stock: 3, precio_final: null },
        { evento: "Del portal", competicion: "Liga", fecha: "2030-02-01", source: "portal", estado: "book", stock: 1, precio_final: 5 },
      ],
      false,
      "2026-11-18"
    );
    expect(evs).toEqual([
      { competicion: "Otros", evento: "Sin precio", fecha: "2030-01-01", conStock: false },
      { competicion: "Liga", evento: "Boca vs River", fecha: "2030-03-01", conStock: true },
    ]);
  });
});

// Criterios de aceptación de TKT-14, sobre el código de la pantalla.
describe("TKT-14 aceptación: el orden de /entradas", () => {
  const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const storefront = leer("../components/tienda/Storefront.tsx");
  const home = storefront.slice(
    storefront.indexOf("export function StorefrontHome"),
    storefront.indexOf("// =============================== CATÁLOGO")
  );

  it("el buscador y las categorías van arriba de los listados que filtran", () => {
    const buscador = home.indexOf('role="search"');
    const categorias = home.indexOf('className="catstrip"');
    const destacados = home.indexOf("eventos={destacados}");
    const proximos = home.indexOf("eventos={proximos}");
    expect(buscador).toBeGreaterThan(-1);
    expect(categorias).toBeGreaterThan(buscador);
    expect(destacados).toBeGreaterThan(categorias);
    expect(proximos).toBeGreaterThan(destacados);
  });

  it("la tienda no repite los bloques de la home pública; 'Por qué TicketMirror' está en la home", () => {
    expect(home).not.toMatch(/t\.pasos|t\.comoH2/);
    expect(home).not.toMatch(/t\.porque|t\.porqueH2/);
    expect(leer("../components/tienda/Landing.tsx")).toMatch(/TX\[lang\]\.porque\.map/);
  });
});
