import { describe, expect, it } from "vitest";
import { mensajeWa, pantallaWaDe } from "./whatsapp-flotante";

describe("pantallaWaDe", () => {
  it("lo público pide acceso", () => {
    for (const p of ["/", "/ingresar", "/recuperar", "/legal/terminos"]) {
      expect(pantallaWaDe(p)).toBe("publica");
    }
  });

  it("la tienda y el listado", () => {
    for (const p of ["/entradas", "/buscar", "/mapa", "/cuenta"]) expect(pantallaWaDe(p)).toBe("tienda");
  });

  it("mis pedidos y el seguimiento", () => {
    expect(pantallaWaDe("/mis-pedidos")).toBe("pedidos");
    expect(pantallaWaDe("/op/7d9f0a2e-0000-4000-8000-000000000000")).toBe("pedidos");
  });
});

describe("mensajeWa", () => {
  it("los mensajes del ticket, por pantalla", () => {
    expect(mensajeWa("publica", null, "es")).toBe("Hola, quiero pedir acceso a TicketMirror.");
    expect(mensajeWa("tienda", null, "es")).toBe("Hola, estoy buscando entradas y tengo una consulta.");
  });

  it("detalle de un evento: nombre y fecha", () => {
    expect(
      mensajeWa("tienda", { tipo: "evento", nombre: "River vs Boca", fecha: "2026-11-15T00:00:00Z" }, "es")
    ).toBe("Hola, consulto por River vs Boca, 15 de noviembre de 2026.");
  });

  it("la fecha no se corre al día anterior (es día UTC)", () => {
    expect(mensajeWa("tienda", { tipo: "evento", nombre: "X", fecha: "2026-07-15T00:00:00Z" }, "es")).toContain(
      "15 de julio"
    );
  });

  it("evento sin fecha: solo el nombre", () => {
    expect(mensajeWa("tienda", { tipo: "evento", nombre: "Final", fecha: null }, "es")).toBe(
      "Hola, consulto por Final."
    );
  });

  it("un pedido: su número", () => {
    expect(mensajeWa("pedidos", { tipo: "pedido", codigo: "TM-1042" }, "es")).toBe(
      "Hola, consulto por el pedido TM-1042."
    );
  });

  it("mis pedidos sin uno en particular", () => {
    expect(mensajeWa("pedidos", null, "es")).toBe("Hola, consulto por un pedido.");
  });

  it("en inglés también", () => {
    expect(mensajeWa("publica", null, "en")).toBe("Hi, I'd like to request access to TicketMirror.");
    expect(mensajeWa("pedidos", { tipo: "pedido", codigo: "TM-1" }, "en")).toBe("Hi, I'm asking about order TM-1.");
  });
});
