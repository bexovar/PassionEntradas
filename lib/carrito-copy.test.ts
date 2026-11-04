import { describe, expect, it } from "vitest";
import { TX } from "./tienda-i18n";

// TKT-17: mandar el pedido es una consulta de disponibilidad (no cobra, no
// reserva, no compromete). Un solo modal y un solo botón: sin pantalla de
// "Revisá tu pedido", sin "Confirmar y enviar", y sin copy que tranquilice
// sobre riesgos que el flujo no tiene.
describe("copy del carrito", () => {
  for (const lang of ["es", "en"] as const) {
    const c = TX[lang].carrito as Record<string, unknown>;
    const textos = Object.values(c)
      .filter((v): v is string => typeof v === "string")
      .join(" \n ");

    it(`${lang}: no hay paso de revisión ni doble confirmación`, () => {
      for (const k of ["revTitulo", "revSub", "revConfirmar", "revVolver"]) {
        expect(c, k).not.toHaveProperty(k);
      }
    });

    it(`${lang}: no tranquiliza sobre riesgos que el flujo no tiene`, () => {
      expect(textos).not.toMatch(/no se env[ií]a nada|no se cobra nada|nothing is sent|nothing is charged|not charged/i);
    });
  }

  it("es: el bloque 'Qué pasa después' vive en el mismo modal y el botón es 'Enviar pedido'", () => {
    const c = TX.es.carrito;
    expect(c.enviar).toBe("Enviar pedido");
    expect(c.queSigue).toBe("Qué pasa después");
    expect(c.queSigueP).toMatch(/confirmamos cada entrada/);
  });
});
