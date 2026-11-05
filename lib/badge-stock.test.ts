import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { badgeEvento } from "./badge-stock";
import { TX } from "./tienda-i18n";

// TKT-16: un solo par de etiquetas a nivel evento, en /buscar y en /entradas.
// El badge responde "¿hay algo comprable acá?": alcanza con una ubicación con
// stock (las "N con stock" de la card). Ninguna promete reserva ni compra.

describe("badgeEvento", () => {
  it("con al menos una ubicación con stock: con stock", () => {
    expect(badgeEvento({ bookable: 1 })).toBe("con_stock");
    expect(badgeEvento({ bookable: 8 })).toBe("con_stock");
  });

  it("sin ninguna ubicación con stock: a consultar", () => {
    expect(badgeEvento({ bookable: 0 })).toBe("a_consultar");
  });

  it("si el evento no trae dato de stock: a consultar (nunca queda sin badge)", () => {
    for (const sinDato of [undefined, null, Number.NaN]) {
      expect(badgeEvento({ bookable: sinDato as unknown as number })).toBe("a_consultar");
    }
  });
});

// Los tests corren sin DOM: cómo se renderiza se verifica sobre el código.
const fuente = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("TKT-16: el badge en las dos pantallas", () => {
  const store = fuente("../components/tienda/Storefront.tsx");
  const BADGE = /<span className=\{`flag flag--\$\{badgeEvento\(ev\)\}`\}>\{t\.badge\[badgeEvento\(ev\)\]\}<\/span>/g;

  it("/buscar (la card) y /entradas (próximos) usan el mismo badge", () => {
    expect(store.match(BADGE)).toHaveLength(2);
  });

  it("todo evento lleva badge: ninguno de los dos está detrás de una condición", () => {
    for (const m of store.matchAll(BADGE)) {
      const antes = store.slice(Math.max(0, m.index! - 40), m.index!);
      expect(antes).not.toMatch(/&&\s*\(?\s*$|\?\s*\(?\s*$/);
    }
  });

  it("no queda el badge viejo en el código", () => {
    expect(store).not.toMatch(/t\.bookNow/);
    const sitio = [store, fuente("../components/tienda/Cart.tsx")].join("\n");
    expect(sitio).not.toMatch(/reserv[aá] ya/i);
  });

  it("los dos estados tienen estilo propio (relleno contra contorno)", () => {
    const css = fuente("../app/(tienda)/tienda.css");
    expect(css).toMatch(/\.flag--a_consultar\s*\{[^}]*background:\s*transparent/);
  });
});

describe("textos del badge", () => {
  for (const lang of ["es", "en"] as const) {
    const b = TX[lang].badge;

    it(`${lang}: los dos estados se distinguen sin depender del color`, () => {
      // Punto lleno contra punto vacío.
      expect(b.con_stock.startsWith("●")).toBe(true);
      expect(b.a_consultar.startsWith("○")).toBe(true);
    });

    it(`${lang}: ninguna etiqueta promete reserva ni compra inmediata`, () => {
      expect(`${b.con_stock} ${b.a_consultar}`).not.toMatch(/reserv|book|compr|buy|ya\b|now/i);
    });
  }

  it("es: CON STOCK y A CONSULTAR", () => {
    expect(TX.es.badge).toEqual({ con_stock: "● Con stock", a_consultar: "○ A consultar" });
  });

  it("no queda ningún 'Reservá ya' ni 'a pedido' en la tienda", () => {
    const todo = JSON.stringify(TX);
    expect(todo).not.toMatch(/reserv[aá] ya|book now/i);
    expect(todo).not.toMatch(/\ba pedido\b/i);
  });
});
