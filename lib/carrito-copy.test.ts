import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TX } from "./tienda-i18n";

// Los tests corren en node, sin DOM: el flujo del modal se verifica sobre el
// código del componente (sin comentarios, para que una nota no cuente).
const cartSrc = readFileSync(
  fileURLToPath(new URL("../components/tienda/Cart.tsx", import.meta.url)),
  "utf8"
)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("TKT-17: del listado al pedido enviado en dos pasos", () => {
  it("el modal no tiene un paso de revisión intermedio", () => {
    expect(cartSrc).not.toMatch(/revisando|setRevisando|revConfirmar|revTitulo/);
  });

  it("'Enviar pedido' hace el envío directo: hay un solo POST y lo dispara ese botón", () => {
    expect(cartSrc.match(/fetch\("\/api\/pedidos"/g)).toHaveLength(1);
    expect(cartSrc).toMatch(/className="cart-send"[\s\S]{0,80}onClick=\{enviar\}/);
    // Un solo botón de acción en el modal.
    expect(cartSrc.match(/className="cart-send"/g)).toHaveLength(1);
  });

  it("'Qué pasa después' vive dentro del mismo modal, antes del botón", () => {
    const sigue = cartSrc.indexOf("{c.queSigue}");
    const boton = cartSrc.indexOf('className="cart-send"');
    expect(sigue).toBeGreaterThan(cartSrc.indexOf('className="cart-modal"'));
    expect(sigue).toBeLessThan(boton);
  });

  it("el éxito es el mismo modal cambiando de contenido, con el link a Mis pedidos", () => {
    // Un solo modal en el componente: el "Pedido enviado" no abre otro.
    expect(cartSrc.match(/className="cart-modal"/g)).toHaveLength(1);
    expect(cartSrc).toMatch(/estado === "done" \?/);
    expect(cartSrc).toMatch(/href="\/mis-pedidos"/);
    expect(TX.es.carrito.okCta).toBe("Ir a Mis pedidos");
    expect(TX.en.carrito.okCta).toBe("Go to My orders");
  });

  it("mientras sale el pedido no se puede tocar de nuevo el botón ni editar el carrito", () => {
    expect(cartSrc).toMatch(/disabled=\{estado === "sending" \|\| items\.length === 0\}/);
    expect(cartSrc).toMatch(/className="cart-rm"[\s\S]{0,120}disabled=\{estado === "sending"\}/);
  });
});

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
    // Sin el paso de revisión, acá se explica que la consulta trae su precio después.
    expect(c.queSigueP).toMatch(/precio de las consultas/);
  });

  it("en: the button and the subtitle talk about sending the order, not a review", () => {
    expect(TX.en.carrito.enviar).toBe("Send order");
    expect(TX.en.carrito.sub).not.toMatch(/for review/i);
  });
});
