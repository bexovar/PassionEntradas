import { describe, expect, it } from "vitest";
import { avisoDeCambio, claveAvisoCliente, claveCotizacion, emailAviso, estadoAvisoCliente, idiomaDe, textoAviso } from "./notificaciones";

const op = (extra: Record<string, unknown> = {}) =>
  ({
    status: "esperando_entrada", tipo: "pedido", confirmada_at: null,
    entrada_recibida_at: null, pago_confirmado_at: null, cerrada_at: null, ...extra,
  }) as any;

describe("avisoDeCambio", () => {
  it("los tres momentos", () => {
    expect(avisoDeCambio(op(), op({ confirmada_at: "x" }))).toBe("pedido_confirmado");
    expect(avisoDeCambio(op({ confirmada_at: "x" }), op({ confirmada_at: "x", entrada_recibida_at: "x" }))).toBe("para_pagar");
    expect(avisoDeCambio(op({ pago_confirmado_at: "x" }), op({ pago_confirmado_at: "x", cerrada_at: "x" }))).toBe("entregada");
  });
  it("saltear pasos avisa solo el de llegada", () => {
    expect(avisoDeCambio(op(), op({ confirmada_at: "x", entrada_recibida_at: "x" }))).toBe("para_pagar");
  });
  it("desmarcar o reabrir no avisa (solo cuando el pedido avanza)", () => {
    const conf = { confirmada_at: "x" };
    // Para pagar -> Confirmado (se desmarcó la entrada).
    expect(avisoDeCambio(op({ ...conf, entrada_recibida_at: "x" }), op(conf))).toBeNull();
    // Entregada -> Para pagar (se desmarcó la entrega).
    expect(avisoDeCambio(op({ ...conf, entrada_recibida_at: "x", cerrada_at: "x" }), op({ ...conf, entrada_recibida_at: "x" }))).toBeNull();
    // Una del staff (nace confirmada) a la que se le desmarca la entrada.
    expect(avisoDeCambio(op({ tipo: "operacion", entrada_recibida_at: "x" }), op({ tipo: "operacion" }))).toBeNull();
    // Reabrir una cancelada.
    expect(avisoDeCambio(op({ tipo: "operacion", status: "cancelada" }), op({ tipo: "operacion" }))).toBeNull();
    expect(avisoDeCambio(op({ ...conf, status: "cancelada" }), op(conf))).toBeNull();
  });
  it("lo que no es uno de los tres no avisa", () => {
    // Pagado: el cliente ya lo sabe.
    expect(avisoDeCambio(op({ entrada_recibida_at: "x" }), op({ entrada_recibida_at: "x", pago_confirmado_at: "x" }))).toBeNull();
    expect(avisoDeCambio(op({ confirmada_at: "x" }), op({ confirmada_at: "x", status: "cancelada" }))).toBeNull();
    // Desmarcar la entrada vuelve a "Confirmado": no se re-avisa (la clave lo frena igual).
    expect(avisoDeCambio(op({ confirmada_at: "x" }), op({ confirmada_at: "x" }))).toBeNull();
  });
  it("una operación del staff nace confirmada: el primer aviso es Para pagar", () => {
    expect(avisoDeCambio(op({ tipo: "operacion" }), op({ tipo: "operacion", entrada_recibida_at: "x" }))).toBe("para_pagar");
  });
});

describe("textos", () => {
  const datos = { code: "BX-1", evento: "River vs Boca", monto: 300, moneda: "USD" as const };
  it("campana en los dos idiomas", () => {
    expect(textoAviso("para_pagar", datos, "es")?.titulo).toBe("Pedido BX-1 listo para pagar");
    expect(textoAviso("para_pagar", datos, "en")?.titulo).toBe("Order BX-1 ready to pay");
    expect(textoAviso("otro", datos, "es")).toBeNull();
  });
  it("email con cómo pagar y el link", () => {
    const m = emailAviso("para_pagar", { ...datos, nombre: "Ana", textoPago: "Alias: x.y.z", url: "https://t/mis-pedidos" }, "es");
    expect(m.subject).toBe("Pedido BX-1 listo para pagar");
    expect(m.text).toMatch(/^Hola Ana,/);
    expect(m.text).toMatch(/Cómo pagar:\nAlias: x\.y\.z/);
    expect(m.text).toMatch(/https:\/\/t\/mis-pedidos/);
    expect(emailAviso("entregada", { ...datos, url: "u" }, "en").text).toMatch(/^Hi,/);
  });
  it("clave e idioma", () => {
    expect(claveAvisoCliente("op1", "entregada")).toBe("cliente:op1:entregada");
    expect(idiomaDe("en")).toBe("en");
    expect(idiomaDe(null)).toBe("es");
  });
});

describe("estadoAvisoCliente (tarjeta del panel)", () => {
  it("dice qué se avisó y cómo salió el email", () => {
    expect(estadoAvisoCliente({ tipo: "para_pagar", email_estado: "enviado" })).toEqual({
      titulo: "Ya puede pagar",
      email: "Email enviado",
      tono: "ok",
    });
    const err = estadoAvisoCliente({ tipo: "entregada", email_estado: "error", email_error: "422 invalid from" });
    expect(err.tono).toBe("error");
    expect(err.email).toBe("El email no salió: 422 invalid from");
  });

  it("sin proveedor o sin email del cliente, en gris", () => {
    expect(estadoAvisoCliente({ tipo: "pedido_confirmado", email_estado: "sin_configurar" }).email).toMatch(/RESEND_API_KEY/);
    expect(estadoAvisoCliente({ tipo: "pedido_confirmado", email_estado: "no_aplica" }).tono).toBe("gris");
  });

  it("un error largo se corta", () => {
    expect(estadoAvisoCliente({ tipo: "entregada", email_estado: "error", email_error: "x".repeat(400) }).email.length).toBeLessThan(170);
  });
});

describe("cotización lista (consulta cotizada)", () => {
  const d = { code: "BX-C1", evento: "Final Libertadores", monto: 250000, moneda: "ARS" as const, vence: "2026-10-15T18:00:00Z" };

  it("campana en los dos idiomas, con precio y hasta cuándo vale", () => {
    const es = textoAviso("cotizacion_lista", d, "es")!;
    expect(es.titulo).toBe("Tu cotización está lista · BX-C1");
    expect(es.cuerpo).toMatch(/Final Libertadores/);
    expect(es.cuerpo).toMatch(/250\.000/);
    expect(es.cuerpo).toMatch(/Aceptala o rechazala en Mis pedidos/);
    expect(es.cuerpo).toMatch(/15 de oct/);
    const en = textoAviso("cotizacion_lista", d, "en")!;
    expect(en.titulo).toBe("Your quote is ready · BX-C1");
    expect(en.cuerpo).toMatch(/Accept or decline it in My orders/);
  });

  it("email con el link a Mis pedidos", () => {
    const m = emailAviso("cotizacion_lista", { ...d, nombre: "Ana", url: "https://x/mis-pedidos" }, "es");
    expect(m.subject).toBe("Tu cotización está lista · BX-C1");
    expect(m.text).toMatch(/^Hola Ana,/);
    expect(m.text).toMatch(/https:\/\/x\/mis-pedidos/);
  });

  it("una clave por versión: re-cotizar avisa de nuevo", () => {
    expect(claveCotizacion("c1", 1)).not.toBe(claveCotizacion("c1", 2));
  });

  it("en el panel se llama Cotización lista", () => {
    expect(estadoAvisoCliente({ tipo: "cotizacion_lista", email_estado: "sin_configurar" }).titulo).toBe("Cotización lista");
  });
});
