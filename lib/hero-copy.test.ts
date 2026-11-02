import { describe, expect, it } from "vitest";
import { TX } from "./tienda-i18n";

// Reglas del registro B2B (TKT-8) para el hero de la home, en los dos idiomas:
// nada de exclusividad ni pertenencia, nada de prometer reserva o
// disponibilidad inmediata, y la promesa del bot ya no vive acá (TKT-9).
const heroDe = (lang: "es" | "en") => {
  const lp = TX[lang].lp;
  return [lp.heroEyebrow, lp.heroTitle1, lp.heroTitle2, lp.heroP, ...lp.bullets].join(" \n ");
};

describe("copys del hero", () => {
  it("no apelan a exclusividad, membresía ni privilegio", () => {
    expect(heroDe("es")).not.toMatch(/exclusiv|miembro|privilegi/i);
    expect(heroDe("en")).not.toMatch(/exclusive|member|privilege/i);
  });

  it("no prometen reserva, inmediatez ni garantía", () => {
    expect(heroDe("es")).not.toMatch(/reserv|inmediat|garantiz/i);
    expect(heroDe("en")).not.toMatch(/\bbook|instant|guarantee/i);
  });

  it("no hablan del bot", () => {
    expect(heroDe("es")).not.toMatch(/\bbot\b/i);
    expect(heroDe("en")).not.toMatch(/\bbot\b/i);
  });

  it("dicen a quién está dirigido el sitio", () => {
    expect(heroDe("es")).toMatch(/agencias/);
    expect(heroDe("es")).toMatch(/hoteles/);
    expect(heroDe("en")).toMatch(/agencies/);
    expect(heroDe("en")).toMatch(/hotels/);
  });

  it("los textos son los del ticket", () => {
    const lp = TX.es.lp;
    expect(lp.heroEyebrow).toBe("Acceso agencias");
    expect(`${lp.heroTitle1} ${lp.heroTitle2}`).toBe("Vendé entradas a los eventos que tus pasajeros quieren");
    expect(lp.heroP).toBe(
      "Entrás, mirás disponibilidad y precio, y armás el pedido. Nosotros conseguimos la entrada y te la entregamos."
    );
    expect(lp.bullets).toEqual([
      "Fútbol europeo, Fórmula 1, Champions, Mundial 2026 y shows",
      "Pedidos y seguimiento en un solo lugar",
      "Acceso para agencias, operadores, hoteles y vendedores de turismo",
    ]);
  });
});
