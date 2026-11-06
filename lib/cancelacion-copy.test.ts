import { describe, expect, it } from "vitest";
import { TX } from "./tienda-i18n";

// TKT-19: el copy de Mis pedidos dice el mismo corte que aplica el botón:
// se cancela hasta que avisamos que procesamos el pago y la entrada está en
// camino. Después, el botón pasa a ser un pedido de cancelación.
describe("copy de cancelación en Mis pedidos", () => {
  const es = TX.es.misPedidos;
  const en = TX.en.misPedidos;

  it("el corte es el aviso de pago procesado, no el pedido de pago", () => {
    expect(es.sub).not.toMatch(/hasta que te pidamos el pago/);
    expect(es.sub).toMatch(
      /podés cancelar hasta que te avisemos que procesamos el pago y que tu entrada está en camino/i
    );
    expect(en.sub).not.toMatch(/until we ask you to pay/);
    expect(en.sub).toMatch(/until we let you know we've processed your payment and your ticket is on its way/);
  });

  it("si el pedido ya avanzó, el error lleva al pedido de cancelación", () => {
    expect(es.noSePuedeCancelar).toMatch(/Pedir cancelación/);
    expect(en.noSePuedeCancelar).toMatch(/Request cancellation/);
  });

  it("después de ese punto hay un pedido de cancelación con su mensaje", () => {
    expect(es.pedirCancelacion).toBe("Pedir cancelación");
    expect(es.waPedirCancelacion("BX-1")).toMatch(/cancelación.*BX-1/);
    expect(en.waPedirCancelacion("BX-1")).toMatch(/cancel.*BX-1/);
  });
});
