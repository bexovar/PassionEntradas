import { describe, expect, it } from "vitest";
import {
  AVISO_CLIENTE,
  clientePuedeCancelar,
  clientePuedeInformarPago,
  clientePuedePedirCancelacion,
  estadoPublicoDe,
  pasosCliente,
} from "@/lib/operaciones";
import { etapaDe, type Etapa, type OpEtapa } from "@/lib/etapas";
import { avisoDeCambio } from "@/lib/notificaciones";
import { mockApplyAction, mockClienteInformarPago, mockCreateOp } from "@/lib/mock-db";

const op = (o: Partial<OpEtapa> = {}): OpEtapa => ({
  status: "esperando_entrada",
  tipo: "pedido",
  confirmada_at: "2026-11-18T10:00:00Z",
  pago_pedido_at: "2026-11-18T10:00:00Z",
  entrada_recibida_at: null,
  pago_confirmado_at: null,
  pago_proveedor_at: null,
  cerrada_at: null,
  ...o,
});

describe("TKT-18: después de 'Ya pagué' la pantalla cambia", () => {
  it("de 'Para pagar' a 'Pago recibido', y el paso del pago queda hecho", () => {
    const antes = op();
    const despues = op({ pago_informado_at: "2026-11-18T11:00:00Z" });
    expect(estadoPublicoDe(antes)).toBe("listo_para_pagar");
    expect(estadoPublicoDe(despues)).toBe("pago_informado");
    const pasos = pasosCliente(estadoPublicoDe(despues))!;
    expect(pasos[1]).toMatchObject({ key: "pago", estado: "hecho" });
    expect(pasos[2]).toMatchObject({ key: "entrega", estado: "actual" });
  });

  it("'Ya pagué' solo aparece cuando se le pidió el pago", () => {
    expect(clientePuedeInformarPago(op())).toBe(true);
    expect(clientePuedeInformarPago(op({ confirmada_at: null, pago_pedido_at: null }))).toBe(false);
    expect(clientePuedeInformarPago(op({ pago_informado_at: "x" }))).toBe(false);
    expect(clientePuedeInformarPago(op({ pago_confirmado_at: "x" }))).toBe(false);
    expect(clientePuedeInformarPago(op({ status: "cancelada" }))).toBe(false);
  });

  it("con la plata en camino ya no cancela solo: lo pide", () => {
    const informado = op({ pago_informado_at: "x" });
    expect(clientePuedeCancelar(informado)).toBe(false);
    expect(clientePuedePedirCancelacion(informado)).toBe(true);
  });

  it("el copy del ticket, tal cual", () => {
    expect(AVISO_CLIENTE.es.pagoRecibido).toBe(
      "Recibimos tu pago correctamente, estamos procesando tu entrada. Escribinos por WhatsApp o te avisamos apenas te la enviemos."
    );
    expect(AVISO_CLIENTE.es.reembolso).toBe("Se agotó la disponibilidad, estamos procesando tu reembolso.");
  });

  it("de punta a punta en la base demo: el cliente avisa y el pedido cambia de estado; dos veces no", () => {
    const creada = mockCreateOp({
      evento: "Boca vs River",
      comprador_alias: null,
      vendedor_alias: null,
      monto: 100,
      fee: 0,
      ticket_id: null,
      fecha_evento: null,
      notas: null,
      cuenta_debitar: null,
      tipo: "pedido",
      cliente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(mockApplyAction(creada.id, { action: "confirmar" }).ok).toBe(true);
    expect(estadoPublicoDe(creada)).toBe("listo_para_pagar");
    const r = mockClienteInformarPago(creada.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(r.ok).toBe(true);
    expect(estadoPublicoDe(creada)).toBe("pago_informado");
    expect(etapaDe(creada)).toBe("pago_informado");
    expect(mockClienteInformarPago(creada.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("TKT-18: el reembolso existe y se ve", () => {
  it("pendiente y hecho, sin pasos de por medio", () => {
    const pendiente = op({ pago_confirmado_at: "x", reembolso_at: "x" });
    expect(estadoPublicoDe(pendiente)).toBe("reembolso");
    expect(estadoPublicoDe({ ...pendiente, reembolsado_at: "x" })).toBe("reembolsado");
    expect(pasosCliente("reembolso")).toBeNull();
  });
});

describe("TKT-18: los estados visibles se corresponden con los del panel, sin los operativos", () => {
  // Una operación en cada etapa del panel.
  const enEtapa: Record<Exclude<Etapa, "pendiente_confirmar" | "vencido">, Partial<OpEtapa>> = {
    esperando_pago: {},
    pago_informado: { pago_informado_at: "x" },
    pendiente_pago_proveedor: { pago_confirmado_at: "x" },
    esperando_envio_proveedor: { pago_confirmado_at: "x", pago_proveedor_at: "x" },
    listo_para_enviar: { pago_confirmado_at: "x", pago_proveedor_at: "x", entrada_recibida_at: "x" },
    entregada: { pago_confirmado_at: "x", pago_proveedor_at: "x", entrada_recibida_at: "x", cerrada_at: "x" },
    reembolso_pendiente: { pago_confirmado_at: "x", reembolso_at: "x" },
    reembolsado: { pago_confirmado_at: "x", reembolso_at: "x", reembolsado_at: "x" },
    cancelada: { status: "cancelada" },
  };

  it("cada etapa cae en un estado del cliente", () => {
    const visto = Object.fromEntries(
      Object.entries(enEtapa).map(([etapa, o]) => {
        const fila = op(o);
        expect(etapaDe(fila)).toBe(etapa);
        return [etapa, estadoPublicoDe(fila)];
      })
    );
    expect(visto).toEqual({
      esperando_pago: "listo_para_pagar",
      pago_informado: "pago_informado",
      // Los tres pasos con el proveedor son operativos: el cliente ve "pagado".
      pendiente_pago_proveedor: "pago_recibido",
      esperando_envio_proveedor: "pago_recibido",
      listo_para_enviar: "pago_recibido",
      entregada: "entregada",
      reembolso_pendiente: "reembolso",
      reembolsado: "reembolsado",
      cancelada: "cancelada",
    });
  });

  it("pendiente de confirmar es 'Recibido' y un vencido sigue pudiendo pagar", () => {
    expect(estadoPublicoDe(op({ confirmada_at: null, pago_pedido_at: null }))).toBe("pedido_recibido");
    expect(estadoPublicoDe(op({ pago_pedido_at: "2020-01-01T00:00:00Z" }))).toBe("listo_para_pagar");
  });

  it("confirmar avisa 'para pagar' (ya no 'confirmado' y después 'para pagar')", () => {
    expect(avisoDeCambio(op({ confirmada_at: null, pago_pedido_at: null }), op())).toBe("para_pagar");
    // Que el cliente avise que pagó no le manda un aviso a él mismo.
    expect(avisoDeCambio(op(), op({ pago_informado_at: "x" }))).toBeNull();
  });
});
