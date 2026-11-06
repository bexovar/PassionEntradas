import { describe, expect, it } from "vitest";
import { nombreDePila, recortarParaPublico, vistaSeguimiento } from "./seguimiento-publico";
import type { ItemPublico, OperacionPublica } from "./operaciones";

// TKT-24: el link /op/<uuid> se abre sin sesión y la agencia se lo manda a su
// pasajero. El monto es lo que la AGENCIA le paga a TicketMirror: si el
// pasajero lo ve, ve el margen de la agencia. Sin sesión: ningún importe y
// solo el nombre de pila del comprador. El agente dueño y el staff ven todo.

const CLIENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTRO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const op: OperacionPublica & { monto: number } = {
  code: "BX-GD5JHH78",
  evento: "River vs Boca",
  comprador_alias: "María Emilia Gallo",
  vendedor_alias: null,
  monto: 897,
  moneda: "USD",
  status: "esperando_entrada",
  entrada_recibida_at: null,
  pago_confirmado_at: null,
  cerrada_at: null,
  fecha_evento: "2026-11-20",
  updated_at: "2026-10-31T12:00:00.000Z",
  tipo: "pedido",
  confirmada_at: null,
};

const items: (ItemPublico & { precio_unitario: number })[] = [
  { evento: "River vs Boca", sector: "Platea", fecha_evento: "2026-11-20", cantidad: 2, precio_unitario: 300 },
  { evento: "River vs Boca", sector: "Popular", fecha_evento: "2026-11-20", cantidad: 1, precio_unitario: 297 },
];

describe("vistaSeguimiento", () => {
  it("sin sesión: vista pública", () => {
    expect(vistaSeguimiento(null, CLIENTE)).toBe("publica");
  });

  it("el agente dueño de la operación: vista completa", () => {
    expect(vistaSeguimiento({ id: CLIENTE, rol: "cliente" }, CLIENTE)).toBe("completa");
  });

  it("otro agente logueado: vista pública", () => {
    expect(vistaSeguimiento({ id: OTRO, rol: "cliente" }, CLIENTE)).toBe("publica");
  });

  it("operación sin cliente (cargada por el staff): un cliente no la ve completa", () => {
    expect(vistaSeguimiento({ id: CLIENTE, rol: "cliente" }, null)).toBe("publica");
  });

  it("el staff ve la completa", () => {
    expect(vistaSeguimiento({ id: OTRO, rol: "administrador" }, CLIENTE)).toBe("completa");
    expect(vistaSeguimiento({ id: OTRO, rol: "moderador" }, null)).toBe("completa");
  });

  it("un usuario sin rol (desactivado) no ve la completa ni de lo suyo", () => {
    expect(vistaSeguimiento({ id: CLIENTE, rol: null }, CLIENTE)).toBe("publica");
  });
});

describe("nombreDePila", () => {
  it("se queda con el primer nombre", () => {
    expect(nombreDePila("María Emilia Gallo")).toBe("María");
    expect(nombreDePila("  Juan   Pérez ")).toBe("Juan");
    expect(nombreDePila("Juan")).toBe("Juan");
  });

  it("un email no es un nombre: no se muestra", () => {
    expect(nombreDePila("maria.gallo@agencia.com")).toBeNull();
  });

  it("vacío o ausente: null", () => {
    expect(nombreDePila(null)).toBeNull();
    expect(nombreDePila("   ")).toBeNull();
  });
});

describe("recortarParaPublico", () => {
  it("saca el monto y el precio de cada línea", () => {
    const r = recortarParaPublico(op, items);
    expect(r.op.monto).toBeNull();
    expect(r.items.map((i) => i.precio_unitario)).toEqual([null, null]);
  });

  it("deja solo el nombre de pila del comprador", () => {
    expect(recortarParaPublico(op, items).op.comprador_alias).toBe("María");
  });

  it("no deja ningún importe en lo que llega a la pantalla", () => {
    const r = recortarParaPublico(op, items);
    expect(JSON.stringify(r)).not.toMatch(/897|300|297/);
  });

  it("solo copia campos públicos: nada que no se haya decidido mostrar", () => {
    const conExtra = { ...op, cliente_id: "x", cuenta_debitar: "y" } as typeof op;
    const r = recortarParaPublico(conExtra, items);
    expect(Object.keys(r.op)).not.toContain("cliente_id");
    expect(Object.keys(r.op)).not.toContain("cuenta_debitar");
  });

  it("el resto de la operación queda igual: estado, evento, código, fechas", () => {
    const r = recortarParaPublico(op, items);
    expect(r.op).toMatchObject({
      code: op.code,
      evento: op.evento,
      status: op.status,
      fecha_evento: op.fecha_evento,
      updated_at: op.updated_at,
      moneda: op.moneda,
    });
    expect(r.items[0]).toMatchObject({ evento: "River vs Boca", sector: "Platea", cantidad: 2 });
  });
});
