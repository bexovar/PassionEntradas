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
    expect(todo).not.toMatch(/"a pedido"/);
  });
});
